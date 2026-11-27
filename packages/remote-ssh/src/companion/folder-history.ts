/**
 * @fileoverview The folder history Remote - SSH keeps for Remote Explorer: the folders and workspaces the user opened
 * on each host, most recent first. Each window keeps its own events in its own file of the extension's global storage
 * folder (the event files of `state/event-files.ts`), so no window's write can drop another's. A read merges every
 * window's file, the newest event of each entry deciding. The extension's global state is one value that every window
 * rewrites from its own copy, so it can't hold the history: the value an earlier version kept there is read as the
 * oldest layer and never written, since any write of it would rewrite every other key of that value.
 */

import type {HistoryEntry, HostHistory} from 'lib-companion';
import {type EventFiles, eventStoreOf, isRecord, type Winner} from 'lib-state';

/** The key in the extension's global state where an earlier version kept the whole history. */
export const FOLDER_HISTORY_KEY = 'folder.history.v1';

/** `ExtensionContext.globalState`, narrowed: only the earlier version's history is read from it. */
export interface HistoryMemento {
  get(key: string): unknown;
}

/** The history of every window, as one window reads and writes it. */
export interface HistoryStore {
  /** Every host's entries, most recent first, as the files hold them now. */
  stored(): HostHistory[];
  /** Records `entry` at the top of `hostKey`'s list. */
  recordOpened(hostKey: string, entry: HistoryEntry): Promise<void>;
  /** Removes `path` from `hostKey`'s list, and says whether it was there. */
  removeOpened(hostKey: string, path: string): Promise<boolean>;
}

/** One change to the history, as a window's file keeps it. */
interface HistoryEvent {
  host: string;
  entry: HistoryEntry;
  kind: 'opened' | 'removed';
  time: number;
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

/** The event a file's value holds, when every member fits. */
function eventOf(value: unknown): HistoryEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entry = entryOf(value.entry);
  return entry !== undefined &&
    typeof value.host === 'string' &&
    (value.kind === 'opened' || value.kind === 'removed') &&
    typeof value.time === 'number'
    ? {host: value.host, entry, kind: value.kind, time: value.time}
    : undefined;
}

/**
 * The earlier version's history as events, the oldest of all, each at time 0: the list keeps its order because the
 * read keeps the order of events that tie. A malformed value is no history.
 */
function legacyEvents(memento: HistoryMemento): HistoryEvent[] {
  const stored = memento.get(FOLDER_HISTORY_KEY);
  if (!isRecord(stored) || !Array.isArray(stored.hosts)) {
    return [];
  }
  return stored.hosts.flatMap((host: unknown) => {
    if (
      !isRecord(host) ||
      typeof host.hostKey !== 'string' ||
      !Array.isArray(host.entries)
    ) {
      return [];
    }
    const hostKey = host.hostKey;
    return host.entries
      .flatMap(value => entryOf(value) ?? [])
      .map(entry => ({
        host: hostKey,
        entry,
        kind: 'opened' as const,
        time: 0,
      }));
  });
}

/** The key of an entry under its host: one entry per path. */
function keyOf(event: HistoryEvent): string {
  return JSON.stringify([event.host, event.entry.path]);
}

/**
 * The hosts of the merged events whose newest event opened them, each most recent first. Hosts the earlier version
 * kept come in its order, then the others by their oldest entry.
 */
function hostsOf(
  winners: ReadonlyMap<string, Winner<HistoryEvent>>,
  legacyOrder: readonly string[],
): HostHistory[] {
  const byHost = new Map<string, Array<Winner<HistoryEvent>>>();
  for (const winner of winners.values()) {
    if (winner.event.kind === 'opened') {
      byHost.set(winner.event.host, [
        ...(byHost.get(winner.event.host) ?? []),
        winner,
      ]);
    }
  }
  function rankOf(hostKey: string): number {
    const position = legacyOrder.indexOf(hostKey);
    return position === -1 ? legacyOrder.length : position;
  }
  function oldestOf(winners: ReadonlyArray<{event: HistoryEvent}>): number {
    return Math.min(...winners.map(winner => winner.event.time));
  }
  return [...byHost.entries()]
    .sort(
      ([firstHost, firstWinners], [secondHost, secondWinners]) =>
        rankOf(firstHost) - rankOf(secondHost) ||
        oldestOf(firstWinners) - oldestOf(secondWinners),
    )
    .map(([hostKey, winners]) => ({
      hostKey,
      entries: winners
        .sort(
          (first, second) =>
            second.event.time - first.event.time ||
            second.session.localeCompare(first.session),
        )
        .map(winner => winner.event.entry),
    }));
}

/** The store of one window: `session` names its own file in `folder`, written with `files` at the times `now` gives. */
export function historyStoreOf(options: {
  folder: string;
  session: string;
  files: EventFiles;
  legacy: HistoryMemento;
  now: () => number;
}): HistoryStore {
  const {folder, session, files, legacy, now} = options;
  const events = eventStoreOf<HistoryEvent>({
    folder,
    session,
    files,
    now,
    keyOf,
    parse: eventOf,
    earlier: () => legacyEvents(legacy),
  });

  function stored(): HostHistory[] {
    const legacyOrder = [
      ...new Set(legacyEvents(legacy).map(event => event.host)),
    ];
    return hostsOf(events.winners(), legacyOrder);
  }

  return {
    stored,
    recordOpened: (hostKey, entry) =>
      events.append([{host: hostKey, entry, kind: 'opened', time: now()}]),
    removeOpened: async (hostKey, removed) => {
      const entry = stored()
        .find(host => host.hostKey === hostKey)
        ?.entries.find(each => each.path === removed);
      if (entry === undefined) {
        return false;
      }
      await events.append([
        {host: hostKey, entry, kind: 'removed', time: now()},
      ]);
      return true;
    },
  };
}
