/**
 * @fileoverview The `clearAllSessionHints` command: it writes an empty hint store that records the time of the clear
 * into the extension's global state, and one line to the log. It shows nothing, and it touches no other key, so an
 * empty store behaves the same. The time lets a record that was cleared be told from one an older copy of the store
 * lost (remote-oss/remote#2326).
 */

import type {CommandHandler} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import type {ConfirmedKey} from '../state/confirmed-update.ts';
import {clearAll, type HintStore} from './hint-store.ts';

/** The clear command over the hint store's `key`, with the time of `now`, logging through `logger`. */
export function clearHintsHandler(
  key: ConfirmedKey<HintStore>,
  now: () => Date,
  logger: Logger,
): CommandHandler {
  return {
    execute: async () => {
      await key.write(clearAll(now().toISOString()));
      logger.info('Cleared all session hints');
    },
  };
}
