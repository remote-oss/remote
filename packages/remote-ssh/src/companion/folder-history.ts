/**
 * @fileoverview The folder history Remote - SSH keeps for Remote Explorer: the folders and workspaces the user opened
 * on each host, most recent first. Each window keeps its own events in its own file of the extension's global storage
 * folder, written whole under a temporary name and renamed over it, so no window's write can drop another's. A read
 * merges every window's file, the newest event of each entry deciding. The extension's global state is one value that
 * every window rewrites from its own copy, so it can't hold the history: the value an earlier version kept there is
 * read as the oldest layer and never written, since any write of it would rewrite every other key of that value.
 */

import {randomBytes, randomUUID} from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {HistoryEntry, HostHistory} from 'lib-companion';

/** The key in the extension's global state where an earlier version kept the whole history. */
export const FOLDER_HISTORY_KEY = 'folder.history.v1';

/** `ExtensionContext.globalState`, narrowed: only the earlier version's history is read from it. */
export interface HistoryMemento {
  get(key: string): unknown;
}

/** What the history's files are written and read with, which a row replaces. */
export interface HistoryFileSystem {
  makeFolder(folder: string): void;
  /** The names in `folder`; none when there is no folder. */
  names(folder: string): string[];
  /** The text of `file`; nothing when it can't be read. */
  read(file: string): string | undefined;
  write(file: string, text: string): void;
  /** Renames `source` over `target`; throws when `source` is gone, as when another window claimed it first. */
  rename(source: string, target: string): void;
  remove(file: string): void;
  /** When `file` last changed, in milliseconds; nothing when it isn't there. */
  modified(file: string): number | undefined;
  /** A name part that no other writer picks. */
  random(): string;
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

/** A window's events, with its session for the order of two events at one time. */
interface Layer {
  session: string;
  events: readonly HistoryEvent[];
}

/** How long a window's file stays untouched before another window may fold it into its own, in milliseconds. */
const FOLD_AFTER = 24 * 60 * 60 * 1000;

/** A window's file, its claim while another window folds it, and a write not yet renamed into place. */
const SESSION_FILE = /^([0-9a-f-]+)\.json$/;
const CLAIM_FILE = /^([0-9a-f-]+)\.claim-[0-9a-f]+$/;
const TEMPORARY_FILE = /\.tmp-[0-9a-f]+$/;

/** The session whose events a file holds: its own file's or its claim's; none for any other name. */
function ownerOf(name: string): string | undefined {
  return SESSION_FILE.exec(name)?.[1] ?? CLAIM_FILE.exec(name)?.[1];
}

/** The mode of the folder and of each file. */
const FOLDER_MODE = 0o700;
const FILE_MODE = 0o600;

/** The file system of this machine. */
export const NODE_HISTORY_FILES: HistoryFileSystem = {
  makeFolder: folder => {
    mkdirSync(folder, {recursive: true, mode: FOLDER_MODE});
  },
  names: folder => {
    try {
      return readdirSync(folder);
    } catch {
      return [];
    }
  },
  read: file => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  },
  write: (file, text) => {
    writeFileSync(file, text, {mode: FILE_MODE});
  },
  rename: (source, target) => {
    renameSync(source, target);
  },
  remove: file => {
    rmSync(file, {force: true});
  },
  modified: file => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return undefined;
    }
  },
  random: () => randomBytes(6).toString('hex'),
};

/** A name for this window's session, which no other window picks. */
export function newSession(): string {
  return randomUUID();
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

/** The events of a file's text; a file that isn't one of ours has none, and a malformed event is dropped. */
function eventsIn(text: string | undefined): HistoryEvent[] {
  let value: unknown;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
  } catch {
    return [];
  }
  return isRecord(value) && Array.isArray(value.events)
    ? value.events.flatMap(event => eventOf(event) ?? [])
    : [];
}

/**
 * The earlier version's history as events, the oldest of all: the newest entry of each host at time 0 and each older
 * one a step earlier, so that the list keeps its order. A malformed value is no history.
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
      .map((entry, position) => ({
        host: hostKey,
        entry,
        kind: 'opened' as const,
        time: -position,
      }));
  });
}

/** The key of an entry under its host: one entry per path. */
function keyOf(event: HistoryEvent): string {
  return JSON.stringify([event.host, event.entry.path]);
}

/** Whether `event` of `session` decides over `rival` of `rivalSession`: it is newer, or as new and of a later session. */
function decides(
  event: HistoryEvent,
  session: string,
  rival: {event: HistoryEvent; session: string} | undefined,
): boolean {
  return (
    rival === undefined ||
    event.time > rival.event.time ||
    (event.time === rival.event.time && session > rival.session)
  );
}

/** The newest event of each entry over every layer, with the session of the layer it came from. */
function merged(
  layers: readonly Layer[],
): Map<string, {event: HistoryEvent; session: string}> {
  const winners = new Map<string, {event: HistoryEvent; session: string}>();
  for (const {session, events} of layers) {
    for (const event of events) {
      const key = keyOf(event);
      if (decides(event, session, winners.get(key))) {
        winners.set(key, {event, session});
      }
    }
  }
  return winners;
}

/**
 * The hosts of the merged events whose newest event opened them, each most recent first. Hosts the earlier version
 * kept come in its order, then the others by their oldest entry.
 */
function hostsOf(
  winners: ReadonlyMap<string, {event: HistoryEvent; session: string}>,
  legacyOrder: readonly string[],
): HostHistory[] {
  const byHost = new Map<
    string,
    Array<{event: HistoryEvent; session: string}>
  >();
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
        .sort((first, second) =>
          decides(first.event, first.session, second) ? -1 : 1,
        )
        .map(winner => winner.event.entry),
    }));
}

/** The outcome of `work` as a promise, which rejects with what `work` throws. */
function settled<Value>(work: () => Value): Promise<Value> {
  return new Promise(resolve => {
    resolve(work());
  });
}

/** The store of one window: `session` names its own file in `folder`, written with `files` at the times `now` gives. */
export function historyStoreOf(options: {
  folder: string;
  session: string;
  files: HistoryFileSystem;
  legacy: HistoryMemento;
  now: () => number;
}): HistoryStore {
  const {folder, session, files, legacy, now} = options;
  const own = new Map<string, HistoryEvent>();
  const ownName = `${session}.json`;

  /** Every window's events: the earlier version's value, the other windows' files and claims, and this window's. */
  function layers(): Layer[] {
    const others = files.names(folder).flatMap(name => {
      const owner = ownerOf(name);
      return owner === undefined || name === ownName
        ? []
        : [
            {
              session: owner,
              events: eventsIn(files.read(path.join(folder, name))),
            },
          ];
    });
    return [
      {session: '', events: legacyEvents(legacy)},
      ...others,
      {session, events: [...own.values()]},
    ];
  }

  function stored(): HostHistory[] {
    const legacyOrder = [
      ...new Set(legacyEvents(legacy).map(event => event.host)),
    ];
    return hostsOf(merged(layers()), legacyOrder);
  }

  /** Takes `event` into this window's own events, unless a newer one of its entry is there already. */
  function keep(event: HistoryEvent): void {
    const known = own.get(keyOf(event));
    if (known === undefined || event.time >= known.time) {
      own.set(keyOf(event), event);
    }
  }

  /**
   * Claims, by renaming them first, the other windows' files and claims untouched for a day, and takes their events into
   * this window's; drops a day-old write that was never renamed into place. Gives back the claims to delete once this
   * window's file holds their events.
   */
  function fold(): string[] {
    const claims: string[] = [];
    const foldBefore = now() - FOLD_AFTER;
    for (const name of files.names(folder)) {
      const file = path.join(folder, name);
      const owner = ownerOf(name);
      const modified = files.modified(file);
      if (modified === undefined || modified > foldBefore || name === ownName) {
        continue;
      }
      if (TEMPORARY_FILE.test(name)) {
        files.remove(file);
        continue;
      }
      if (owner === undefined) {
        continue;
      }
      const claim = path.join(folder, `${owner}.claim-${files.random()}`);
      try {
        files.rename(file, claim);
      } catch {
        // Another window claimed it first.
        continue;
      }
      eventsIn(files.read(claim)).forEach(keep);
      claims.push(claim);
    }
    return claims;
  }

  /** Writes this window's events whole, under a temporary name renamed over its file, then ends what it folded. */
  function write(claims: readonly string[]): void {
    files.makeFolder(folder);
    const file = path.join(folder, ownName);
    const temporary = `${file}.tmp-${files.random()}`;
    files.write(temporary, JSON.stringify({events: [...own.values()]}));
    files.rename(temporary, file);
    for (const claim of claims) {
      files.remove(claim);
    }
  }

  return {
    stored,
    recordOpened: (hostKey, entry) =>
      settled(() => {
        const claims = fold();
        keep({host: hostKey, entry, kind: 'opened', time: now()});
        write(claims);
      }),
    removeOpened: (hostKey, removed) =>
      settled(() => {
        const entry = stored()
          .find(host => host.hostKey === hostKey)
          ?.entries.find(each => each.path === removed);
        if (entry === undefined) {
          return false;
        }
        const claims = fold();
        keep({host: hostKey, entry, kind: 'removed', time: now()});
        write(claims);
        return true;
      }),
  };
}
