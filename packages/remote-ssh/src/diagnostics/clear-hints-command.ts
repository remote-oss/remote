/**
 * @fileoverview The `clearAllSessionHints` command: it writes a clearing event, with the time of the clear, into the
 * hint events of this window, and one line to the log. The event hides every record that started before it, in every
 * window, so no other window's file is written. It shows nothing and touches no state of the extension.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import type {HintEvents} from './hint-store.ts';

/** The clear command over the hint `events`, with the time of `now`, logging through `logger`. */
export function clearHintsHandler(
  events: HintEvents,
  now: () => Date,
  logger: Logger,
): CommandHandler {
  return {
    execute: async () => {
      await events.clear(now().toISOString());
      logger.info('Cleared all session hints');
    },
  };
}
