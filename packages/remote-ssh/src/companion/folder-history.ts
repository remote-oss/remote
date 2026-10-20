/**
 * @fileoverview The folder history Remote - SSH keeps for Remote Explorer: the folders and workspaces the user opened
 * on each host, most recent first, in the extension's own `globalState` key. Every operation reads the stored value
 * when it runs, so two windows writing in turn keep each other's entries.
 */

import type {HistoryEntry, HostHistory} from 'lib-companion';
import {removeFolderCopies} from 'lib-companion';

/** The extension's own key in `globalState` for the folder history. */
export const FOLDER_HISTORY_KEY = 'folder.history.v1';

/** `ExtensionContext.globalState`, narrowed. */
export interface HistoryMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** Whether a value is a plain object with named members. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entry a stored value holds, when its path and kind fit. */
function entryOf(value: unknown): HistoryEntry | undefined {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    (value.kind !== 'folder' && value.kind !== 'workspace')
  ) {
    return undefined;
  }
  return {path: value.path, kind: value.kind};
}

/** The host a stored value holds with its good entries, or none when the key is bad or no entry is left. */
function hostOf(value: unknown): HostHistory | undefined {
  if (
    !isRecord(value) ||
    typeof value.hostKey !== 'string' ||
    !Array.isArray(value.entries)
  ) {
    return undefined;
  }
  const entries = value.entries.flatMap(entry => entryOf(entry) ?? []);
  return entries.length === 0 ? undefined : {hostKey: value.hostKey, entries};
}

/** The stored history, read now: a malformed value is no history, a malformed host or entry is dropped. */
export function storedHistory(memento: HistoryMemento): HostHistory[] {
  const stored = memento.get(FOLDER_HISTORY_KEY);
  if (!isRecord(stored) || !Array.isArray(stored.hosts)) {
    return [];
  }
  return stored.hosts.flatMap(host => hostOf(host) ?? []);
}

/** Records `entry` at the top of `hostKey`'s list, removing any earlier copy of its path. */
export async function recordOpened(
  memento: HistoryMemento,
  hostKey: string,
  entry: HistoryEntry,
): Promise<void> {
  const hosts = storedHistory(memento);
  const known = hosts.find(host => host.hostKey === hostKey);
  const entries = [
    entry,
    ...(known?.entries ?? []).filter(each => each.path !== entry.path),
  ];
  await memento.update(FOLDER_HISTORY_KEY, {
    hosts:
      known === undefined
        ? [...hosts, {hostKey, entries}]
        : hosts.map(host => (host === known ? {hostKey, entries} : host)),
  });
}

/** Removes every copy of `path` under `hostKey`, drops the host when it is left empty, and says whether anything went. */
export async function removeOpened(
  memento: HistoryMemento,
  hostKey: string,
  path: string,
): Promise<boolean> {
  const removal = removeFolderCopies(storedHistory(memento), hostKey, path);
  if (!removal.changed) {
    return false;
  }
  await memento.update(FOLDER_HISTORY_KEY, {
    hosts: removal.hosts.filter(host => host.entries.length > 0),
  });
  return true;
}
