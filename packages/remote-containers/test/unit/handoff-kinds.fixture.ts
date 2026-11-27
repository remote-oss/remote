/**
 * @fileoverview The handoffs of the rows, over files in memory: the kinds the extension leaves for the window that
 * follows a reload, with the time of the files' own clock and an earlier version's global state beside them.
 */

import {createHash} from 'node:crypto';
import type {MemoryFiles} from 'lib-state/testing/memory-files';
import {
  isIntentValue,
  REBUILD_INTENTS_KEY,
  type RebuildHandoffs,
} from '../../src/open/rebuild-intent.ts';
import {
  isPendingEdit,
  PENDING_EDITS_KEY,
  type PendingEditHandoffs,
} from '../../src/open/pending-edit.ts';
import {handoffKindOf} from '../../src/state/handoffs.ts';
import type {IntentMemento} from '../../src/state/timed-store.ts';

/** The extension's storage folder in the rows. */
const STORAGE = '/profile/globalStorage/remote-oss.remote-containers';

/** The folder of the handoffs named `name`. */
export function handoffFolderOf(
  name: 'pending-edit' | 'rebuild-intent',
): string {
  return `${STORAGE}/handoffs/${name}`;
}

/** A memento that holds nothing, which is what the global state of a profile that never ran an earlier version is. */
const EMPTY: IntentMemento = {
  get: () => undefined,
  update: () => Promise.resolve(),
};

/** The rebuild intents in `files`, and what an earlier version kept in `earlier`. */
export function rebuildHandoffsOn(
  files: MemoryFiles,
  earlier: IntentMemento = EMPTY,
): RebuildHandoffs {
  return handoffKindOf({
    storageFolder: STORAGE,
    name: 'rebuild-intent',
    earlier,
    earlierKey: REBUILD_INTENTS_KEY,
    isValue: isIntentValue,
    now: () => files.clock,
    files,
  });
}

/** The pending edits in `files`, and what an earlier version kept in `earlier`. */
export function pendingEditHandoffsOn(
  files: MemoryFiles,
  earlier: IntentMemento = EMPTY,
): PendingEditHandoffs {
  return handoffKindOf({
    storageFolder: STORAGE,
    name: 'pending-edit',
    earlier,
    earlierKey: PENDING_EDITS_KEY,
    isValue: isPendingEdit,
    now: () => files.clock,
    files,
  });
}

/** Puts a file of the text `text` where the handoff of `kind` for `key` is kept, whatever the text holds. */
export function writeRawHandoff(
  files: MemoryFiles,
  kind: 'pending-edit' | 'rebuild-intent',
  key: string,
  text: string,
): void {
  const name = createHash('sha256').update(key).digest('hex');
  files.write(`${handoffFolderOf(kind)}/${name}.json`, text);
}
