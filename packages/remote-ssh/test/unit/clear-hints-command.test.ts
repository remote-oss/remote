import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  clearHintsHandler,
  type HintStoreState,
} from '../../src/diagnostics/clear-hints-command.ts';

/** A global state that records its writes, in order. */
function stateOf(): {state: HintStoreState; calls: Array<[string, undefined]>} {
  const calls: Array<[string, undefined]> = [];
  return {
    state: {
      update: (key, value) => {
        calls.push([key, value]);
        return Promise.resolve();
      },
    },
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

describe('the clear command (F-2605 6.6)', () => {
  it("F-2605.AC-20: the store's key is the only update, deleted with undefined", async () => {
    const {state, calls} = stateOf();
    const {logger} = logging();
    await clearHintsHandler(state, logger).execute();
    deepStrictEqual(calls, [['remote.ssh.hints', undefined]]);
  });

  it('F-2605.AC-20: the log has the cleared line', async () => {
    const {state} = stateOf();
    const {sink, logger} = logging();
    await clearHintsHandler(state, logger).execute();
    deepStrictEqual(
      sink.lines.map(line => line.message),
      ['Cleared all session hints'],
    );
  });

  it('F-2605.AC-21: an empty store runs the same update, and no error is reported', async () => {
    const {state, calls} = stateOf();
    const {logger} = logging();
    const outcome = await clearHintsHandler(state, logger).execute();
    deepStrictEqual(
      [outcome, calls],
      [undefined, [['remote.ssh.hints', undefined]]],
    );
  });
});
