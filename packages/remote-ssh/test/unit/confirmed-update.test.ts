import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  confirmedUpdate,
  READ_BACK_DELAY_MILLISECONDS,
} from '../../src/state/confirmed-update.ts';

/** A state whose writes `keeps` says whether to keep, in turn; every write and delay is listed in `calls`. */
function scene(keeps: boolean[]) {
  const stored: {value?: string} = {};
  const calls: string[] = [];
  const sink = new MemorySink();
  const writes = [...keeps];
  const environment = {
    delay: (milliseconds: number) => {
      calls.push(`wait ${String(milliseconds)}`);
      return Promise.resolve();
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
  return {state, environment, calls, sink};
}

describe('the write of a record that is read back (remote-oss/remote#2326)', () => {
  it('F-2605 BR-9, F-2108 BR-8 (c2326-held): a write that holds is written once and read back after the fixed delay, with nothing logged', async () => {
    const {state, environment, calls, sink} = scene([true]);
    await confirmedUpdate(state, 'key', 'value', environment);
    deepStrictEqual(
      [calls, sink.lines.map(line => line.message)],
      [['write key=value', `wait ${String(READ_BACK_DELAY_MILLISECONDS)}`], []],
    );
  });

  it('F-2605 BR-9, F-2108 BR-8 (c2326-reverted-once): a write that is reverted is written once more, read back again, and logged as a warning', async () => {
    const {state, environment, calls, sink} = scene([false, true]);
    await confirmedUpdate(state, 'key', 'value', environment);
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
    await confirmedUpdate(state, 'key', 'value', environment);
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
});
