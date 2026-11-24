/**
 * @fileoverview The folder history's files in memory, shared by the windows of one row, and the earlier version's global
 * state, for the rows of the store and of its readers.
 */

import {
  FOLDER_HISTORY_KEY,
  type HistoryMemento,
  type HistoryStore,
  historyStoreOf,
} from '../../src/companion/folder-history.ts';
import type {MemoryFiles} from './event-files.fixture.ts';

/** The folder of the rows' history files. */
const HISTORY_FOLDER =
  '/profile/globalStorage/remote-oss.remote-ssh/folder-history';

/** The earlier version's global state, holding `value` as its history. */
export function legacyOf(value?: unknown): HistoryMemento {
  return {
    get: (key: string) => (key === FOLDER_HISTORY_KEY ? value : undefined),
  };
}

/** The store of the window with session `session` over `files`, its clock the files' own. */
export function windowOn(
  files: MemoryFiles,
  session: string,
  legacy: HistoryMemento = legacyOf(),
): HistoryStore {
  return historyStoreOf({
    folder: HISTORY_FOLDER,
    session,
    files,
    legacy,
    now: () => files.clock,
  });
}
