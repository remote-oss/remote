/**
 * @fileoverview The `clearAllSessionHints` command: it deletes the hint store's key from the extension's global
 * state and writes one line to the log. It shows nothing, and it touches no other key, so an empty store behaves
 * the same.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {HINT_STORE_KEY} from './hint-store.ts';

/** The global-state port the command writes through: `update` with `undefined` deletes the key. */
export interface HintStoreState {
  update(key: string, value: undefined): PromiseLike<void>;
}

/** The clear command over `state`, logging through `logger`. */
export function clearHintsHandler(
  state: HintStoreState,
  logger: Logger,
): CommandHandler {
  return {
    execute: async () => {
      await state.update(HINT_STORE_KEY, undefined);
      logger.info('Cleared all session hints');
    },
  };
}
