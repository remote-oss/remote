import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {clearHintsHandler} from '../../src/diagnostics/clear-hints-command.ts';
import type {HintEvents} from '../../src/diagnostics/hint-store.ts';

const CLEAR_TIME = new Date('2026-11-02T00:00:09Z');

/** Hint events that record the clears written to them, in order. */
function eventsOf(): {events: HintEvents; clears: string[]} {
  const clears: string[] = [];
  return {
    events: {
      read: () => ({records: []}),
      record: () => Promise.resolve(),
      clear: clearedAt => {
        clears.push(clearedAt);
        return Promise.resolve();
      },
    },
    clears,
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
  it('F-2605.AC-20, AC-22: the only write is a clear that says when it was made', async () => {
    const {events, clears} = eventsOf();
    const {logger} = logging();
    await clearHintsHandler(events, () => CLEAR_TIME, logger).execute();
    deepStrictEqual(clears, ['2026-11-02T00:00:09.000Z']);
  });

  it('F-2605.AC-20: the log has the cleared line', async () => {
    const {events} = eventsOf();
    const {sink, logger} = logging();
    await clearHintsHandler(events, () => CLEAR_TIME, logger).execute();
    deepStrictEqual(
      sink.lines.map(line => line.message),
      ['Cleared all session hints'],
    );
  });

  it('F-2605.AC-21: a clear with no record to hide runs the same write, and no error is reported', async () => {
    const {events, clears} = eventsOf();
    const {logger} = logging();
    const outcome = await clearHintsHandler(
      events,
      () => CLEAR_TIME,
      logger,
    ).execute();
    deepStrictEqual(
      [outcome, clears],
      [undefined, ['2026-11-02T00:00:09.000Z']],
    );
  });
});
