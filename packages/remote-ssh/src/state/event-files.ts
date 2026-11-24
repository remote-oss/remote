/**
 * @fileoverview The records many windows add to, kept as events in files: each window writes only its own file of a
 * folder in the extension's global storage, whole, under a temporary name renamed over it, so no window's write can
 * drop another's. A read merges every window's file, the newest event of each key deciding. The extension's global
 * state is one value that every window rewrites from its own copy, so it can't hold such records. The store knows no
 * event's meaning: its owner gives the key of an event, how a file's value becomes one, and the layer an earlier
 * version kept in the global state.
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

/** What the event files are written and read with, which a row replaces. */
export interface EventFiles {
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

/** An event of a store: the time it happened decides over an older one of its key. */
export interface TimedEvent {
  time: number;
}

/** The newest event of a key, with the session of the window whose file it came from. */
export interface Winner<Event> {
  event: Event;
  session: string;
}

/** A window's events, with its session for the order of two events at one time. */
interface Layer<Event> {
  session: string;
  events: readonly Event[];
}

/** The store of one window over the files of every window. */
export interface EventStore<Event> {
  /** The newest event of each key over the earlier layer, every other window's file and this window's events. */
  winners(): Map<string, Winner<Event>>;
  /** Takes `events` into this window's own and writes them; rejects when the write fails. */
  append(events: readonly Event[]): Promise<void>;
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
export const NODE_EVENT_FILES: EventFiles = {
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
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `event` of `session` decides over `rival`: it is newer, or as new and of a later session. */
function decides<Event extends TimedEvent>(
  event: Event,
  session: string,
  rival: Winner<Event> | undefined,
): boolean {
  return (
    rival === undefined ||
    event.time > rival.event.time ||
    (event.time === rival.event.time && session > rival.session)
  );
}

/** The outcome of `work` as a promise, which rejects with what `work` throws. */
function settled<Value>(work: () => Value): Promise<Value> {
  return new Promise(resolve => {
    resolve(work());
  });
}

/**
 * The store of one window: `session` names its own file in `folder`, written with `files` at the times `now` gives.
 * `keyOf` names what an event is about, `parse` gives the event a value of a file holds, `earlier` the events an
 * earlier version kept elsewhere, the oldest of all, and `prune` the events of this window worth keeping when it writes.
 */
export function eventStoreOf<Event extends TimedEvent>(options: {
  folder: string;
  session: string;
  files: EventFiles;
  now: () => number;
  keyOf: (event: Event) => string;
  parse: (value: unknown) => Event | undefined;
  earlier: () => readonly Event[];
  prune?: (events: readonly Event[]) => readonly Event[];
}): EventStore<Event> {
  const {folder, session, files, now, keyOf, parse, earlier, prune} = options;
  const own = new Map<string, Event>();
  const ownName = `${session}.json`;

  /** The events of a file's text; a file that isn't one of ours has none, and a malformed event is dropped. */
  function eventsIn(text: string | undefined): Event[] {
    let value: unknown;
    try {
      value = text === undefined ? undefined : JSON.parse(text);
    } catch {
      return [];
    }
    return isRecord(value) && Array.isArray(value.events)
      ? value.events.flatMap(event => parse(event) ?? [])
      : [];
  }

  /** Every window's events: the earlier version's, the other windows' files and claims, and this window's. */
  function layers(): Array<Layer<Event>> {
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
      {session: '', events: earlier()},
      ...others,
      {session, events: [...own.values()]},
    ];
  }

  /** Takes `event` into this window's own events, unless a newer one of its key is there already. */
  function keep(event: Event): void {
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
    winners: () => {
      const winners = new Map<string, Winner<Event>>();
      for (const layer of layers()) {
        for (const event of layer.events) {
          const key = keyOf(event);
          if (decides(event, layer.session, winners.get(key))) {
            winners.set(key, {event, session: layer.session});
          }
        }
      }
      return winners;
    },
    append: events =>
      settled(() => {
        const claims = fold();
        events.forEach(keep);
        if (prune !== undefined) {
          const kept = prune([...own.values()]);
          own.clear();
          kept.forEach(keep);
        }
        write(claims);
      }),
  };
}
