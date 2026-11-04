import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {invocationGuardOf} from '../../src/open/invocation-guard.ts';

/** A guard over a log that remembers its lines. */
function guarded() {
  const sink = new MemorySink();
  const guard = invocationGuardOf(
    createLogger(sink, {minimumLevel: () => 'debug'}),
  );
  return {guard, lines: () => sink.lines.map(line => line.message)};
}

describe('the invocation guard (card containers-200, §2.3)', () => {
  it('F-0202 AC-45: an invocation that has not passed its check does not hold the others', async () => {
    const {guard} = guarded();
    const answers: boolean[] = [];
    await guard.run('Open', () =>
      guard.run('Open', second => {
        answers.push(second());
        return Promise.resolve();
      }),
    );
    deepStrictEqual(answers, [true]);
  });

  it('F-0202 AC-51: the first to pass its check goes on, a later one is absorbed with a log line, and the guard is free once the first ends', async () => {
    const {guard, lines} = guarded();
    const answers: boolean[] = [];
    await guard.run('Open', async pass => {
      answers.push(pass());
      await guard.run('Open', second => {
        answers.push(second());
        return Promise.resolve();
      });
    });
    await guard.run('Open', pass => {
      answers.push(pass());
      return Promise.resolve();
    });
    deepStrictEqual(
      [answers, lines()],
      [[true, false, true], ['Open is already running']],
    );
  });

  it('F-0202 AC-45: an invocation that never passes leaves the guard free, even when it throws', async () => {
    const {guard} = guarded();
    const answers: boolean[] = [];
    await guard
      .run('Open', () => Promise.reject(new Error('stopped')))
      .catch(() => undefined);
    await guard.run('Open', pass => {
      answers.push(pass());
      return Promise.resolve();
    });
    deepStrictEqual(answers, [true]);
  });
});
