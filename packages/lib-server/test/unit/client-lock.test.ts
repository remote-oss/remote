import {deepStrictEqual} from 'node:assert';
import {lockIdFor, withClientLock} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';
import {MemoryLockPort} from '../../src/testing/memory-lock-port.ts';
import {drain, settle} from './clock-driver.fixture.ts';

// The folder and identity every row of this file uses.
const FOLDER = '/srv/locks';
const IDENTITY = 'u@h:22';
const PATH = `${FOLDER}/${lockIdFor(IDENTITY)}.lock`;

// Every polling row of this file holds the lock while the same work runs; onWaiting reports
// through `onWaiting`.
function startLocked(
  port: MemoryLockPort,
  clock: FakeClock,
  onWaiting: () => void,
): Promise<{kind: 'done'; value: string} | {kind: 'lockTimeout'}> {
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
        removes: port.calls.filter(call => call === `remove ${PATH}`).length,
      },
      {
        result: {kind: 'done', value: 'value'},
        seenDuringWork: true,
        left: [],
        first: `createExclusive ${PATH} ${IDENTITY}`,
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
        removes: port.calls.filter(call => call === `remove ${PATH}`).length,
      },
      {result: {rejected: 'the work failed'}, left: [], removes: 1},
    );
  });

  it('file exists, age 1000; the holder removes it on the 3rd ageMilliseconds call: onWaiting once, done, the clock advanced 1500 ms in 500 steps', async () => {
    const clock = new FakeClock();
    const port = new MemoryLockPort(clock);
    await port.createExclusive(PATH, IDENTITY);
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
    await port.createExclusive(PATH, IDENTITY);
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
        removes: port.calls.filter(call => call === `remove ${PATH}`).length,
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
    await port.createExclusive(PATH, IDENTITY);
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
    await port.createExclusive(PATH, IDENTITY);
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
    await port.createExclusive(PATH, IDENTITY);
    port.setAge(PATH, 240000);
    let createCalls = 0;
    const originalCreate = port.createExclusive.bind(port);
    port.createExclusive = (path: string, text: string) => {
      createCalls += 1;
      if (createCalls === 2) {
        // The takeover re-create: the rival won it, so report an existing file.
        return Promise.resolve('exists');
      }
      return originalCreate(path, text);
    };
    let waited = 0;
    const promise = startLocked(port, clock, () => {
      waited += 1;
    });
    const result = await settle(promise, clock, 500, 5000);
    // The row's "exactly one remove call" counts the takeover remove only: no remove while losing the
    // race and none before the file disappears; the finally-remove after the work is a second.
    const lastCreate = port.calls.lastIndexOf(
      `createExclusive ${PATH} ${IDENTITY}`,
    );
    deepStrictEqual(
      {
        result,
        waited,
        createCalls,
        takeoverRemovesBeforeLastCreate: port.calls
          .slice(0, lastCreate)
          .filter(call => call === `remove ${PATH}`).length,
        totalRemoves: port.calls.filter(call => call === `remove ${PATH}`)
          .length,
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
    await port.createExclusive(PATH, IDENTITY);
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
        removes: port.calls.filter(call => call === `remove ${PATH}`).length,
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
    await port.createExclusive('/fresh.lock', IDENTITY);
    const fresh = await port.ageMilliseconds('/fresh.lock');
    deepStrictEqual([absent, fresh], [undefined, 0]);
  });
});
