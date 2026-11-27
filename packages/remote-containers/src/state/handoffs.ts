/**
 * @fileoverview The handoffs a window leaves for the window that follows its reload: each kind in a folder of the
 * extension's own storage, one file for each handoff, taken once by the window that gets to it first. A value an
 * earlier version kept under a key of the global state is read, never written, and ends by expiring there.
 */

import {
  type EventFiles,
  type HandoffStore,
  handoffStoreOf,
  NODE_EVENT_FILES,
} from 'lib-state';
import path from 'node:path';
import {type IntentMemento, peekTimedEntry} from './timed-store.ts';

/** How long a handoff of a window that reloads stays takable, in milliseconds. */
const HANDOFF_LIFETIME_MILLISECONDS = 5 * 60 * 1000;

/** One kind of handoff: its files, and where an earlier version kept the same kind. */
export interface HandoffKind<Value> {
  store: HandoffStore<Value>;
  /** The extension's global state, where an earlier version kept this kind. */
  earlier: IntentMemento;
  /** The key of the earlier version's map in the global state. */
  earlierKey: string;
  isValue: (value: unknown) => value is Value;
  now: () => number;
}

/** What a kind is made of. */
export interface HandoffKindOptions<Value> {
  /** The extension's storage folder. */
  storageFolder: string;
  /** The folder's name under `handoffs/`. */
  name: string;
  earlier: IntentMemento;
  earlierKey: string;
  isValue: (value: unknown) => value is Value;
  now: () => number;
  /** The files the handoffs are kept in; the file system of this machine when none is given. */
  files?: EventFiles;
}

/** The handoffs of one kind in the folder `handoffs/<name>` of the extension's storage. */
export function handoffKindOf<Value>(
  options: HandoffKindOptions<Value>,
): HandoffKind<Value> {
  const {storageFolder, name, earlier, earlierKey, isValue, now, files} =
    options;
  return {
    store: handoffStoreOf({
      folder: path.join(storageFolder, 'handoffs', name),
      files: files ?? NODE_EVENT_FILES,
      now,
      isValue,
      lifetime: HANDOFF_LIFETIME_MILLISECONDS,
    }),
    earlier,
    earlierKey,
    isValue,
    now,
  };
}

/** Leaves `value` for `name`; rejects when the write fails. */
export function leaveHandoff<Value>(
  kind: HandoffKind<Value>,
  name: string,
  value: Value,
): Promise<void> {
  return kind.store.leave(name, value);
}

/**
 * Takes the handoff for `name` once, with the time it was left: the file's, else the value an earlier version kept,
 * which is left where it is.
 */
export function takeHandoff<Value>(
  kind: HandoffKind<Value>,
  name: string,
): {storedAt: number; value: Value} | undefined {
  return (
    kind.store.take(name) ??
    peekTimedEntry(
      kind.earlier,
      kind.earlierKey,
      name,
      kind.now(),
      kind.isValue,
      HANDOFF_LIFETIME_MILLISECONDS,
    )
  );
}
