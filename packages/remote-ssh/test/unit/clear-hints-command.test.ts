import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {clearHintsHandler} from '../../src/diagnostics/clear-hints-command.ts';
import type {HintStore} from '../../src/diagnostics/hint-store.ts';
import {confirmedKeyOf} from '../../src/state/confirmed-update.ts';

const CLEAR_TIME = new Date('2026-11-02T00:00:09Z');

/** A global state that records its writes, in order. */
function stateOf(): {
  key: ReturnType<typeof confirmedKeyOf<HintStore>>;
  calls: Array<[string, HintStore]>;
} {
  const calls: Array<[string, HintStore]> = [];
  const stored: {value?: HintStore} = {};
  const logger = createLogger(new MemorySink(), {minimumLevel: () => 'error'});
  return {
    key: confirmedKeyOf<HintStore>(
      {
        get: () => stored.value,
        update: (name, value) => {
          calls.push([name, value]);
          stored.value = value;
          return Promise.resolve();
        },
      },
      'remote.ssh.hints',
      {delay: () => Promise.resolve(), logger},
    ),
    calls,
  };
}

/** A logger over a memory sink that reads every level. */
function logging(): {
  logger: ReturnType<typeof createLogger>;
  sink: MemorySink;
} {
  const sink = new MemorySink();
  return {
    sink,
    logger: createLogger(sink, {minimumLevel: (): Level => 'trace'}),
  };
}

const CLEARED: HintStore = {records: [], clearedAt: '2026-11-02T00:00:09.000Z'};

describe('the clear command (F-2605 6.6)', () => {
  it('F-2605.AC-20, AC-22: the store’s key is the only update, an empty store that says when it was cleared', async () => {
    const {key, calls} = stateOf();
    const {logger} = logging();
    await clearHintsHandler(key, () => CLEAR_TIME, logger).execute();
    deepStrictEqual(calls, [['remote.ssh.hints', CLEARED]]);
  });

  it('F-2605.AC-20: the log has the cleared line', async () => {
    const {key} = stateOf();
    const {sink, logger} = logging();
    await clearHintsHandler(key, () => CLEAR_TIME, logger).execute();
    deepStrictEqual(
      sink.lines.map(line => line.message),
      ['Cleared all session hints'],
    );
  });

  it('F-2605.AC-21: an empty store runs the same update, and no error is reported', async () => {
    const {key, calls} = stateOf();
    const {logger} = logging();
    const outcome = await clearHintsHandler(
      key,
      () => CLEAR_TIME,
      logger,
    ).execute();
    deepStrictEqual(
      [outcome, calls],
      [undefined, [['remote.ssh.hints', CLEARED]]],
    );
  });
});
