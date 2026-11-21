import {deepStrictEqual} from 'node:assert';
import {
  clientLockPath,
  type LockFilePort,
  lockIdFor,
  withClientLock,
} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';
import {MemoryLockPort} from '../../src/testing/memory-lock-port.ts';
import {drain, settle} from './clock-driver.fixture.ts';

// The folder and identity every row of this file uses.
const FOLDER = '/srv/locks';
const IDENTITY = 'u@h:22';
const PATH = `${FOLDER}/vscode-remote-ssh-${lockIdFor(IDENTITY)}-install.lock`;
const TICKET = `${PATH}.takeover`;

// Every polling row of this file holds the lock while the same work runs; onWaiting reports
// through `onWaiting`.
function startLocked(
  port: MemoryLockPort,
  clock: FakeClock,
  onWaiting: () => void,
): Promise<
  {kind: 'done'; value: string} | {kind: 'lockTimeout'} | {kind: 'cancelled'}
> {
  return withClientLock(
    port,
    FOLDER,
    IDENTITY,
    clock,
    () => Promise.resolve('value'),
    onWaiting,
  );
}

/**
 * The settled value of a promise, or the message of the error it rejected with: one value the
 * folded tests assert over.
 */
async function outcomeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return {rejected: error instanceof Error ? error.message : String(error)};
  }
}

/** How many removals of the lock file `port` was asked for, of either kind. */
function removalsOf(port: MemoryLockPort): number {
  return port.calls.filter(
    call => call === `remove ${PATH}` || call === `removeIfModified ${PATH}`,
  ).length;
}

/** A promise a row opens when it chooses. */
class Gate {
  readonly opened: Promise<void>;
  private openWith: () => void = () => undefined;

  /** A gate not yet open. */
  constructor() {
    this.opened = new Promise(resolve => {
      this.openWith = resolve;
    });
  }

  /** Opens the gate. */
  open(): void {
    this.openWith();
  }
}

/**
 * A waiter's view of `shared` that stops before its next call once it has made `call` for the
 * `occurrence`-th time, until `resume`.
 */
function pausedAfter(shared: MemoryLockPort, call: string, occurrence = 1) {
  const calls: string[] = [];
  let paused = false;
  const resumed = new Gate();
  const reached = new Gate();
  async function through<T>(
    made: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (paused) {
      await resumed.opened;
    }
    calls.push(made);
    const result = await operation();
    if (
      !paused &&
      calls.filter(earlier => earlier === call).length === occurrence
    ) {
      paused = true;
      reached.open();
    }
    return result;
  }
  const port: LockFilePort = {
    createExclusive: path =>
      through(`createExclusive ${path}`, () => shared.createExclusive(path)),
    ageMilliseconds: path =>
      through(`ageMilliseconds ${path}`, () => shared.ageMilliseconds(path)),
    modifiedMilliseconds: path =>
      through(`modifiedMilliseconds ${path}`, () =>
        shared.modifiedMilliseconds(path),
      ),
    remove: path => through(`remove ${path}`, () => shared.remove(path)),
    removeIfModified: (path, modified) =>
      through(`removeIfModified ${path}`, () =>
        shared.removeIfModified(path, modified),
      ),
  };
  return {
    port,
    calls,
    reachedPause: reached.opened,
    resume: () => {
      resumed.open();
    },
  };
}

/** A window that waits for the lock over `port` and, once it holds it, notes `name` in `holders` and keeps it. */
function waiter(
  port: LockFilePort,
  clock: FakeClock,
  name: string,
  holders: string[],
): void {
  void withClientLock(
    port,
    FOLDER,
    IDENTITY,
    clock,
    () => {
      holders.push(name);
      return new Promise<string>(() => undefined);
    },
    () => undefined,
  );
}

/** A lock port whose file is four minutes old, on a clock of its own. */
async function staleLock() {
  const clock = new FakeClock();
  const shared = new MemoryLockPort(clock);
  await shared.createExclusive(PATH);
  shared.setAge(PATH, 240000);
  return {clock, shared};
}

/** A stale lock with a waiter, `late`, stopped right after it read the file as four minutes old. */
async function lateWaiter() {
  const {clock, shared} = await staleLock();
  const holders: string[] = [];
  const late = pausedAfter(shared, `ageMilliseconds ${PATH}`);
  waiter(late.port, clock, 'late', holders);
  await late.reachedPause;
  return {clock, shared, holders, late};
}

/** A port whose takeover ticket cannot be made. */
class NoTicketPort extends MemoryLockPort {
  /** Rejects a create of the ticket; any other create is the memory port's. */
  override createExclusive(path: string): Promise<'created' | 'exists'> {
    return path === TICKET
      ? Promise.reject(new Error('no ticket'))
      : super.createExclusive(path);
  }
}

describe('client lock (card server-05 table)', () => {
  it("lockIdFor('u@h:22') -> 8 lower-case hex chars; same twice; differs for 'u@h:23'", () => {
    const lockId = lockIdFor(IDENTITY);
    deepStrictEqual(
      {
        shape: /^[0-9a-f]{8}$/.test(lockId),
        same: lockId === lockIdFor(IDENTITY),
        differs: lockId !== lockIdFor('u@h:23'),
      },
      {shape: true, same: true, differs: true},
    );
  });

  it('clientLockPath: vscode-remote-ssh-<id>-install.lock in the folder, the id of the identity', () => {
    deepStrictEqual(
      clientLockPath(FOLDER, IDENTITY),
      `/srv/locks/vscode-remote-ssh-${lockIdFor(IDENTITY)}-install.lock`,
    );
  });

  it('cancelled before the first try: cancelled, no file created', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    const cancellation = new AbortController();
    cancellation.abort();
    const result = await withClientLock(
      port,
      FOLDER,
      IDENTITY,
      clock,
      () => Promise.resolve('value'),
      () => undefined,
      {cancellation: cancellation.signal},
    );
    deepStrictEqual(
      {result, calls: port.calls},
      {result: {kind: 'cancelled'}, calls: []},
    );
  });

  it("cancelled while waiting on a held file: cancelled after the poll, the holder's file stays, onWaiting once", async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH);
    const cancellation = new AbortController();
    let waited = 0;
    const promise = withClientLock(
      port,
      FOLDER,
      IDENTITY,
      clock,
      () => Promise.resolve('value'),
      () => {
        waited += 1;
        cancellation.abort();
      },
      {cancellation: cancellation.signal},
    );
    const result = await settle(promise, clock, 500, 500);
    deepStrictEqual(
      {
        result,
        waited,
        left: port.files(),
        removes: removalsOf(port),
      },
      {result: {kind: 'cancelled'}, waited: 1, left: [PATH], removes: 0},
    );
  });

  it('cancelled while the file is created (card #2915): cancelled, the file removed, and the work never runs', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    const cancellation = new AbortController();
    const create = port.createExclusive.bind(port);
    port.createExclusive = async (path: string) => {
      const created = await create(path);
      cancellation.abort();
      return created;
    };
    let worked = false;
    const result = await withClientLock(
      port,
      FOLDER,
      IDENTITY,
      clock,
      () => {
        worked = true;
        return Promise.resolve('value');
      },
      () => undefined,
      {cancellation: cancellation.signal},
    );
    deepStrictEqual(
      {result, worked, files: port.files()},
      {result: {kind: 'cancelled'}, worked: false, files: []},
    );
  });

  it('no file: withClientLock -> done with the work value; the file is created before work runs and removed after', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    let fileSeenDuringWork = false;
    function work(): Promise<string> {
      fileSeenDuringWork = port.files().includes(PATH);
      return Promise.resolve('value');
    }
    const promise = withClientLock(
      port,
      FOLDER,
      IDENTITY,
      clock,
      work,
      () => undefined,
    );
    await drain();
    deepStrictEqual(
      {
        result: await promise,
        seenDuringWork: fileSeenDuringWork,
        left: port.files(),
        first: port.calls.at(0),
        removes: removalsOf(port),
      },
      {
        result: {kind: 'done', value: 'value'},
        seenDuringWork: true,
        left: [],
        first: `createExclusive ${PATH}`,
        removes: 1,
      },
    );
  });

  it('work throws: the error propagates and the file is removed', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    function work(): Promise<string> {
      return Promise.reject(new Error('the work failed'));
    }
    const promise = withClientLock(
      port,
      FOLDER,
      IDENTITY,
      clock,
      work,
      () => undefined,
    );
    await drain();
    deepStrictEqual(
      {
        result: await outcomeOf(promise),
        left: port.files(),
        removes: removalsOf(port),
      },
      {result: {rejected: 'the work failed'}, left: [], removes: 1},
    );
  });

  it('file exists, age 1000; the holder removes it on the 3rd ageMilliseconds call: onWaiting once, done, the clock advanced 1500 ms in 500 steps', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH);
    port.setAge(PATH, 1000);
    let ageReads = 0;
    const originalAge = port.ageMilliseconds.bind(port);
    port.ageMilliseconds = async (path: string) => {
      ageReads += 1;
      const ageValue = await originalAge(path);
      if (ageReads === 3) {
        await port.remove(PATH);
      }
      return ageValue;
    };
    let waited = 0;
    const promise = startLocked(port, clock, () => {
      waited += 1;
    });
    const result = await settle(promise, clock, 500, 1500);
    deepStrictEqual(
      {
        result,
        clock: clock.now(),
        ageReads,
        waited,
        waitSteps: clock.waitSteps(),
        left: port.files(),
      },
      {
        result: {kind: 'done', value: 'value'},
        clock: 1500,
        ageReads: 3,
        waited: 1,
        waitSteps: [500, 500, 500],
        left: [],
      },
    );
  });

  it('file exists forever, age 1000: after 120000 ms of polling -> lockTimeout; onWaiting once; no remove call', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH);
    port.setAge(PATH, 1000);
    let waited = 0;
    const promise = startLocked(port, clock, () => {
      waited += 1;
    });
    const result = await settle(promise, clock, 500, 120000);
    deepStrictEqual(
      {
        result,
        waited,
        removes: removalsOf(port),
        clock: clock.now(),
      },
      {
        result: {kind: 'lockTimeout'},
        waited: 1,
        removes: 0,
        clock: 120000,
      },
    );
  });

  it('file exists, age 240000: removed, created, done (takeover); onWaiting not called', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH);
    port.setAge(PATH, 240000);
    let waited = 0;
    const promise = startLocked(port, clock, () => {
      waited += 1;
    });
    const result = await settle(promise, clock, 500, 500);
    deepStrictEqual(
      {result, waited, left: port.files()},
      {result: {kind: 'done', value: 'value'}, waited: 0, left: []},
    );
  });

  it('file exists, age 239999: polls (no takeover); the age grows per poll -> takeover when it reaches 240000 -> done', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH);
    port.setAge(PATH, 239999);
    const promise = startLocked(port, clock, () => undefined);
    const result = await settle(promise, clock, 500, 2000);
    deepStrictEqual(
      {result, clock: clock.now(), left: port.files()},
      {result: {kind: 'done', value: 'value'}, clock: 500, left: []},
    );
  });

  it('takeover race: after the remove, createExclusive returns exists (another waiter won); keep polling; when the file is later removed -> done; the takeover remove happens once (row counts the takeover remove only)', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH);
    port.setAge(PATH, 240000);
    let createCalls = 0;
    const originalCreate = port.createExclusive.bind(port);
    port.createExclusive = (path: string) => {
      if (path !== PATH) {
        return originalCreate(path);
      }
      createCalls += 1;
      if (createCalls === 2) {
        // The takeover re-create: the rival won it, so report an existing file.
        return Promise.resolve('exists');
      }
      return originalCreate(path);
    };
    let waited = 0;
    const promise = startLocked(port, clock, () => {
      waited += 1;
    });
    const result = await settle(promise, clock, 500, 5000);
    // The row's "exactly one remove call" counts the takeover remove only: no remove while losing the
    // race and none before the file disappears; the finally-remove after the work is a second.
    const lastCreate = port.calls.lastIndexOf(`createExclusive ${PATH}`);
    deepStrictEqual(
      {
        result,
        waited,
        createCalls,
        takeoverRemovesBeforeLastCreate: port.calls
          .slice(0, lastCreate)
          .filter(call => call === `removeIfModified ${PATH}`).length,
        totalRemoves: removalsOf(port),
        left: port.files(),
      },
      {
        result: {kind: 'done', value: 'value'},
        waited: 1,
        createCalls: 3,
        takeoverRemovesBeforeLastCreate: 1,
        totalRemoves: 2,
        left: [],
      },
    );
  });

  it('custom options {poll 100, giveUp 300, takeover 1000} with a file aged 10: three polls then lockTimeout at 300 ms', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH);
    port.setAge(PATH, 10);
    let waited = 0;
    const promise = withClientLock(
      port,
      FOLDER,
      IDENTITY,
      clock,
      () => Promise.resolve('value'),
      () => {
        waited += 1;
      },
      {
        pollMilliseconds: 100,
        giveUpMilliseconds: 300,
        takeoverAgeMilliseconds: 1000,
      },
    );
    const result = await settle(promise, clock, 100, 300);
    deepStrictEqual(
      {
        result,
        clock: clock.now(),
        waited,
        removes: removalsOf(port),
      },
      {
        result: {kind: 'lockTimeout'},
        clock: 300,
        waited: 1,
        removes: 0,
      },
    );
  });

  it('MemoryLockPort: ageMilliseconds of an absent path -> undefined', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    const absent = await port.ageMilliseconds('/absent.lock');
    await port.createExclusive('/fresh.lock');
    const fresh = await port.ageMilliseconds('/fresh.lock');
    deepStrictEqual([absent, fresh], [undefined, 0]);
  });
});

describe('the takeover of a stale client lock (card #2918, ruling-2918-takeover-ticket, F-2408 BR-6, BR-8)', () => {
  it('two waiters that both read the file as four minutes old: the faster takes it over, and the later one, under the ticket, finds it fresh and waits', async () => {
    const {clock, shared, holders, late} = await lateWaiter();
    waiter(shared, clock, 'fast', holders);
    await drain();
    late.resume();
    await drain();
    deepStrictEqual(
      {holders, files: shared.files()},
      {holders: ['fast'], files: [PATH]},
    );
  });

  it('while a takeover holds the ticket and the lock is absent, a waiter that read it stale touches nothing, a new window creates it, and the taker waits', async () => {
    const {clock, shared} = await staleLock();
    const holders: string[] = [];
    const other = pausedAfter(shared, `ageMilliseconds ${PATH}`);
    const taker = pausedAfter(shared, `removeIfModified ${PATH}`);
    waiter(other.port, clock, 'other', holders);
    await other.reachedPause;
    waiter(taker.port, clock, 'taker', holders);
    await taker.reachedPause;
    const atThePause = shared.files();
    other.resume();
    await drain();
    waiter(shared, clock, 'new', holders);
    await drain();
    taker.resume();
    await drain();
    deepStrictEqual(
      {
        atThePause,
        holders,
        files: shared.files(),
        otherRemoved: other.calls.filter(call => call.startsWith('remove')),
      },
      {atThePause: [TICKET], holders: ['new'], files: [PATH], otherRemoved: []},
    );
  });

  it("a lock released and created anew after the taker's age read under the ticket is left: the taker removes only the stale file it read", async () => {
    const {clock, shared} = await staleLock();
    const holders: string[] = [];
    const taker = pausedAfter(shared, `ageMilliseconds ${PATH}`, 2);
    waiter(taker.port, clock, 'taker', holders);
    await taker.reachedPause;
    await shared.remove(PATH);
    waiter(shared, clock, 'fresh', holders);
    await drain();
    taker.resume();
    await drain();
    deepStrictEqual(
      {holders, files: shared.files()},
      {holders: ['fresh'], files: [PATH]},
    );
  });

  it('a lock released while a waiter takes the ticket is not removed under it, and the next round creates it', async () => {
    const {shared, holders, late} = await lateWaiter();
    await shared.remove(PATH);
    late.resume();
    await drain();
    deepStrictEqual(
      {
        holders,
        files: shared.files(),
        lockRemoves: late.calls.filter(call => call === `remove ${PATH}`),
      },
      {holders: ['late'], files: [PATH], lockRemoves: []},
    );
  });

  it('a ticket ten seconds old is broken and the waiter takes over at its next poll; one 9999 ms old is left', async () => {
    const ticketKept: boolean[] = [];
    const holdersAfterPoll: string[][] = [];
    for (const ticketAge of [9999, 10000]) {
      const {clock, shared} = await staleLock();
      await shared.createExclusive(TICKET);
      shared.setAge(TICKET, ticketAge);
      const holders: string[] = [];
      waiter(shared, clock, 'waiter', holders);
      await drain();
      ticketKept.push(shared.files().includes(TICKET));
      clock.advance(500);
      await drain();
      holdersAfterPoll.push(holders);
    }
    deepStrictEqual(
      {ticketKept, holdersAfterPoll},
      {ticketKept: [true, false], holdersAfterPoll: [[], ['waiter']]},
    );
  });

  it('a ticket that cannot be made rejects with the error and leaves the lock', async () => {
    const clock = new FakeClock();
    const port = new NoTicketPort(clock);
    await port.createExclusive(PATH);
    port.setAge(PATH, 240000);
    deepStrictEqual(
      {
        outcome: await outcomeOf(startLocked(port, clock, () => undefined)),
        files: port.files(),
      },
      {outcome: {rejected: 'no ticket'}, files: [PATH]},
    );
  });

  it("a holder whose lock was taken over leaves the taker's file at its late release", async () => {
    const clock = new FakeClock();
    const shared = new MemoryLockPort(clock);
    const firstEnd = new Gate();
    const first = withClientLock(
      shared,
      FOLDER,
      IDENTITY,
      clock,
      () => firstEnd.opened.then(() => 'first'),
      () => undefined,
    );
    await drain();
    clock.advance(240000);
    const holders: string[] = [];
    waiter(shared, clock, 'second', holders);
    await drain();
    firstEnd.open();
    const firstOutcome = await first;
    deepStrictEqual(
      {firstOutcome, holders, files: shared.files()},
      {
        firstOutcome: {kind: 'done', value: 'first'},
        holders: ['second'],
        files: [PATH],
      },
    );
  });

  it('a release of its own unchanged file removes it, by the modification time read at its create', async () => {
    const clock = new FakeClock();
    const shared = new MemoryLockPort(clock);
    const outcome = await startLocked(shared, clock, () => undefined);
    deepStrictEqual(
      {outcome, files: shared.files(), calls: shared.calls},
      {
        outcome: {kind: 'done', value: 'value'},
        files: [],
        calls: [
          `createExclusive ${PATH}`,
          `modifiedMilliseconds ${PATH}`,
          `removeIfModified ${PATH}`,
        ],
      },
    );
  });
});
