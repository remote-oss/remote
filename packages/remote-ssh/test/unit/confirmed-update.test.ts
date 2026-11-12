import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  confirmedKeyOf,
  READ_BACK_DELAY_MILLISECONDS,
  timerDelay,
} from '../../src/state/confirmed-update.ts';

/** A state whose writes `keeps` says whether to keep, in turn; every write and delay is listed in `calls`. */
function scene(keeps: boolean[], gated = false) {
  const stored: {value?: string} = {};
  const calls: string[] = [];
  const sink = new MemorySink();
  const writes = [...keeps];
  const gate: {release: () => void} = {release: () => undefined};
  const environment = {
    delay: (milliseconds: number) => {
      calls.push(`wait ${String(milliseconds)}`);
      return gated
        ? new Promise<void>(resolve => {
            gate.release = resolve;
          })
        : Promise.resolve();
    },
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  };
  const state = {
    get: () => stored.value,
    update: (key: string, value: string) => {
      calls.push(`write ${key}=${value}`);
      if (writes.shift() ?? true) {
        stored.value = value;
      }
      return Promise.resolve();
    },
  };
  return {state, environment, calls, sink, gate};
}

describe('the write of a record that is read back (remote-oss/remote#2326)', () => {
  it('F-2605 BR-9, F-2108 BR-8 (c2326-held): a write that holds is written once and read back after the fixed delay, with nothing logged', async () => {
    const {state, environment, calls, sink} = scene([true]);
    const key = confirmedKeyOf(state, 'key', environment);
    await key.write('value');
    await key.verified();
    deepStrictEqual(
      [calls, sink.lines.map(line => line.message)],
      [['write key=value', `wait ${String(READ_BACK_DELAY_MILLISECONDS)}`], []],
    );
  });

  it('F-2605 BR-9, F-2108 BR-8 (c2326-reverted-once): a write that is reverted is written once more, read back again, and logged as a warning', async () => {
    const {state, environment, calls, sink} = scene([false, true]);
    const key = confirmedKeyOf(state, 'key', environment);
    await key.write('value');
    await key.verified();
    deepStrictEqual(
      [calls, sink.lines.map(line => [line.level, line.message])],
      [
        [
          'write key=value',
          `wait ${String(READ_BACK_DELAY_MILLISECONDS)}`,
          'write key=value',
          `wait ${String(READ_BACK_DELAY_MILLISECONDS)}`,
        ],
        [
          [
            'warn',
            'the global state key key did not hold what was written, and holds it after a second write',
          ],
        ],
      ],
    );
  });

  it('F-2605 BR-9, F-2108 BR-8 (c2326-lost): a write that is reverted twice stops after two writes and logs an error with the key and the bytes', async () => {
    const {state, environment, calls, sink} = scene([false, false]);
    const key = confirmedKeyOf(state, 'key', environment);
    await key.write('value');
    await key.verified();
    deepStrictEqual(
      [
        calls.filter(call => call.startsWith('write')).length,
        sink.lines.map(line => [line.level, line.message]),
      ],
      [
        2,
        [
          [
            'error',
            'the global state key key does not hold what was written: 7 bytes written, 0 read',
          ],
        ],
      ],
    );
  });

  it('F-2604 AC-22 (c2326-not-waited): the write returns when the state took the value, before the read back has waited at all', async () => {
    const {state, environment, calls, gate} = scene([true], true);
    const key = confirmedKeyOf(state, 'key', environment);
    await key.write('value');
    const beforeDelay = [...calls];
    gate.release();
    await key.verified();
    deepStrictEqual(
      [beforeDelay, calls],
      [
        ['write key=value', `wait ${String(READ_BACK_DELAY_MILLISECONDS)}`],
        ['write key=value', `wait ${String(READ_BACK_DELAY_MILLISECONDS)}`],
      ],
    );
  });

  it('F-2605 BR-9 (c2326-latest): the read back checks the value written last, so a later write is not undone by the check of an earlier one', async () => {
    const {state, environment, calls} = scene([true, true]);
    const key = confirmedKeyOf(state, 'key', environment);
    await key.write('first');
    await key.write('second');
    await key.verified();
    deepStrictEqual(
      calls.filter(call => call.startsWith('write')),
      ['write key=first', 'write key=second'],
    );
  });

  it('F-2605 BR-9 (c2326-timer): the delay of the editor is a timer', async () => {
    await timerDelay(1);
    deepStrictEqual(typeof timerDelay(1).then, 'function');
  });
});
