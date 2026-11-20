import {deepStrictEqual} from 'node:assert';
import {
  type Clock,
  clientLockPath,
  type LockFilePort,
  lockIdFor,
} from 'lib-server';
import {MemoryLockPort} from 'lib-server/testing/memory-lock-port';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  HeldClientLocks,
  holdClientLockStep,
} from '../../src/pipeline/client-lock-step.ts';
import {connectionKeyOf} from '../../src/pipeline/connection-step.ts';
import {LOCAL_LOCK_TIMEOUT} from '../../src/pipeline/failure.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {INPUT} from './pipeline.fixture.ts';

/** The editor's temporary folder in the rows. */
const FOLDER = '/tmp';

/** A clock whose wait moves its time on at once. */
function steppingClock(): Clock {
  let time = 0;
  return {
    now: () => time,
    wait: milliseconds => {
      time += milliseconds;
      return Promise.resolve();
    },
  };
}

/** The input of a connect to the plain host `text`. */
function inputFor(text: string): ConnectInput {
  return {...INPUT, target: {kind: 'plain', text}, rawHostString: text};
}

/** The client lock file of the connect of `input`. */
function pathOf(input: ConnectInput): string {
  return clientLockPath(FOLDER, connectionKeyOf(input));
}

/** Lets the queued promise callbacks run. */
function drained(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * A step over `port`, with what it removed at the extension's end and what it logged; that removal deletes the file
 * from `port` at once, as the Node port's does.
 */
function stepOver(port: LockFilePort, clock: Clock = steppingClock()) {
  const sink = new MemorySink();
  const removedNow: string[] = [];
  const held = new HeldClientLocks(path => {
    removedNow.push(path);
    void port.remove(path);
  });
  const step = holdClientLockStep({
    port,
    folder: FOLDER,
    clock,
    held,
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
  });
  return {step, held, removedNow, sink};
}

/** What `step` gives for `input` with no wait to tell, its hold given back at once when it holds one. */
async function takenAndReleased(
  step: ReturnType<typeof holdClientLockStep>,
  input: ConnectInput,
) {
  const result = await step(
    input,
    () => undefined,
    new AbortController().signal,
  );
  if (result.kind === 'done') {
    result.value.release();
  }
  return result;
}

/** A step that holds the lock of the alias `dev`, with the controller of its connect's cancellation. */
async function heldWithCancellation() {
  const clock = steppingClock();
  const port = new MemoryLockPort(clock);
  const {step} = stepOver(port, clock);
  const input = inputFor('dev');
  const cancellation = new AbortController();
  const result = await step(input, () => undefined, cancellation.signal);
  return {port, input, cancellation, result};
}

/** A step whose lock of the alias `dev` another window already holds, with that window's hold. */
async function heldByAnother() {
  const clock = steppingClock();
  const port = new MemoryLockPort(clock);
  const {step} = stepOver(port, clock);
  const input = inputFor('dev');
  const first = await step(
    input,
    () => undefined,
    new AbortController().signal,
  );
  return {clock, port, step, input, first};
}

describe('the client install lock of a connect (card #2844, F-2408 BR-6 to BR-8, 7.E2)', () => {
  it('BR-6: a free lock is held at once, without a wait, and its release removes the file; a second release does nothing', async () => {
    const clock = steppingClock();
    const port = new MemoryLockPort(clock);
    const {step} = stepOver(port, clock);
    const input = inputFor('dev');
    let waits = 0;
    const result = await step(
      input,
      () => {
        waits += 1;
      },
      new AbortController().signal,
    );
    const whileHeld = port.files();
    if (result.kind === 'done') {
      result.value.release();
      result.value.release();
    }
    await drained();
    deepStrictEqual(
      {kind: result.kind, waits, whileHeld, afterRelease: port.files()},
      {kind: 'done', waits: 0, whileHeld: [pathOf(input)], afterRelease: []},
    );
  });

  it("BR-6: two aliases of one host hold two files; the second doesn't wait for the first", async () => {
    const clock = steppingClock();
    const port = new MemoryLockPort(clock);
    const {step} = stepOver(port, clock);
    const signal = new AbortController().signal;
    let waits = 0;
    function onWaiting(): void {
      waits += 1;
    }
    const first = await step(inputFor('one'), onWaiting, signal);
    const second = await step(inputFor('two'), onWaiting, signal);
    deepStrictEqual(
      {kinds: [first.kind, second.kind], waits, files: port.files().length},
      {kinds: ['done', 'done'], waits: 0, files: 2},
    );
  });

  it('6.1 step 3: a second window of the alias waits, tells it once, and holds the lock once the first releases it', async () => {
    const {port, step, input, first} = await heldByAnother();
    let waits = 0;
    const second = step(
      input,
      () => {
        waits += 1;
        if (first.kind === 'done') {
          first.value.release();
        }
      },
      new AbortController().signal,
    );
    deepStrictEqual(
      {kind: (await second).kind, waits, files: port.files()},
      {kind: 'done', waits: 1, files: [pathOf(input)]},
    );
  });

  it('BR-7, 7.E2: a lock held for the whole two minutes ends in the local lock timeout', async () => {
    const {clock, step, input} = await heldByAnother();
    const result = await step(
      input,
      () => undefined,
      new AbortController().signal,
    );
    deepStrictEqual(
      {result, now: clock.now()},
      {result: {kind: 'failed', failure: LOCAL_LOCK_TIMEOUT}, now: 120000},
    );
  });

  it("BR-8: a left file four minutes old is taken over as the window's own, without a wait", async () => {
    const clock = steppingClock();
    const port = new MemoryLockPort(clock);
    const {step} = stepOver(port, clock);
    const input = inputFor('dev');
    await port.createExclusive(pathOf(input));
    port.setAge(pathOf(input), 240000);
    let waits = 0;
    const result = await step(
      input,
      () => {
        waits += 1;
      },
      new AbortController().signal,
    );
    deepStrictEqual(
      {
        kind: result.kind,
        waits,
        fileAge: await port.ageMilliseconds(pathOf(input)),
      },
      {kind: 'done', waits: 0, fileAge: 0},
    );
  });

  it("a connect cancelled while it waits ends cancelled and leaves the holder's file", async () => {
    const {port, step, input} = await heldByAnother();
    const cancellation = new AbortController();
    const result = await step(
      input,
      () => {
        cancellation.abort();
      },
      cancellation.signal,
    );
    deepStrictEqual(
      {result, files: port.files()},
      {
        result: {kind: 'failed', failure: {kind: 'cancelled'}},
        files: [pathOf(input)],
      },
    );
  });

  it('a temporary folder that cannot hold the lock never fails the connect: the error is logged and nothing is held', async () => {
    const port: LockFilePort = {
      createExclusive: () => Promise.reject(new Error('EACCES: denied')),
      ageMilliseconds: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(),
    };
    const {step, held, removedNow, sink} = stepOver(port);
    const input = inputFor('dev');
    const result = await takenAndReleased(step, input);
    held.releaseAll();
    deepStrictEqual(
      {
        kind: result.kind,
        removedNow,
        warned: sink.lines.some(
          line =>
            line.message ===
            `the local install lock ${lockIdFor(connectionKeyOf(input))} in /tmp could not be used: Error: EACCES: denied`,
        ),
      },
      {kind: 'done', removedNow: [], warned: true},
    );
  });

  it("BR-8: the extension's end removes the files of the locks still held, once, and not a released one whose own removal has run", async () => {
    const clock = steppingClock();
    const port = new MemoryLockPort(clock);
    const {step, held, removedNow} = stepOver(port, clock);
    const signal = new AbortController().signal;
    const kept = inputFor('kept');
    await takenAndReleased(step, inputFor('released'));
    await step(kept, () => undefined, signal);
    await drained();
    held.releaseAll();
    held.releaseAll();
    deepStrictEqual(removedNow, [pathOf(kept)]);
  });

  it('BR-6, BR-8 (gate 44548262473): a window that ends between its release and the removal of its file still leaves no file: the lock stays held until then', async () => {
    const clock = steppingClock();
    const port = new MemoryLockPort(clock);
    const {step, held, removedNow} = stepOver(port, clock);
    const input = inputFor('dev');
    await takenAndReleased(step, input);
    held.releaseAll();
    deepStrictEqual(removedNow, [pathOf(input)]);
  });

  it("BR-6 (triton on #2867): a window that takes the lock right after another's release keeps its file: the file is removed once, by the release, never after", async () => {
    const clock = steppingClock();
    const port = new MemoryLockPort(clock);
    const {step} = stepOver(port, clock);
    const input = inputFor('dev');
    await takenAndReleased(step, input);
    const successor = await step(
      input,
      () => undefined,
      new AbortController().signal,
    );
    await drained();
    deepStrictEqual(
      {
        kind: successor.kind,
        files: port.files(),
        removes: port.calls.filter(call => call === `remove ${pathOf(input)}`)
          .length,
      },
      {kind: 'done', files: [pathOf(input)], removes: 1},
    );
  });

  it('BR-6, BR-8 (gate 44641609918): a lock taken while the extension ends (its file created after the end began) is removed at once, removed only once, and the connect ends cancelled', async () => {
    const clock = steppingClock();
    const port = new MemoryLockPort(clock);
    const {step, held} = stepOver(port, clock);
    const input = inputFor('dev');
    held.releaseAll();
    const result = await step(
      input,
      () => undefined,
      new AbortController().signal,
    );
    await drained();
    deepStrictEqual(
      {
        result,
        files: port.files(),
        removes: port.calls.filter(call => call === `remove ${pathOf(input)}`)
          .length,
      },
      {
        result: {kind: 'failed', failure: {kind: 'cancelled'}},
        files: [],
        removes: 1,
      },
    );
  });

  it('BR-6 (card #2915): a connect given up while it holds the lock gives it back, with no release of its own', async () => {
    const {port, input, cancellation, result} = await heldWithCancellation();
    const whileHeld = port.files();
    cancellation.abort();
    await drained();
    deepStrictEqual(
      {kind: result.kind, whileHeld, afterTheCancel: port.files()},
      {kind: 'done', whileHeld: [pathOf(input)], afterTheCancel: []},
    );
  });

  it('BR-6 (card #2915): a cancel that comes after the release removes nothing more: the file is removed once', async () => {
    const {port, input, cancellation, result} = await heldWithCancellation();
    if (result.kind === 'done') {
      result.value.release();
    }
    cancellation.abort();
    await drained();
    deepStrictEqual(
      {
        files: port.files(),
        removes: port.calls.filter(call => call === `remove ${pathOf(input)}`)
          .length,
      },
      {files: [], removes: 1},
    );
  });
});
