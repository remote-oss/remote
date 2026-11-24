/**
 * @fileoverview The connection hints the extension keeps for its troubleshooting view: the records of the two most
 * recent resolves, oldest first. Each window keeps the records of its own resolves as events in its own file of the
 * extension's global storage folder (the event files of `state/event-files.ts`), so no window's write can drop another
 * window's hint; the clear command is an event too, which hides every record that started before it. The extension's
 * global state is one value that every window rewrites from its own copy, so it can't hold the records: the value an
 * earlier version kept there is read as the oldest layer and never written.
 */

import type {TextRange} from '../surfaces/strings.ts';
import {type EventFiles, eventStoreOf, isRecord} from '../state/event-files.ts';

/** The key in the extension's global state where an earlier version kept the hints. */
const EARLIER_KEY = 'remote.ssh.hints';

/** One hint of a record: an environment fact, a recognised error, or the log text. */
export type SessionHint =
  | {kind: 'environment'; message: string; details?: string}
  | {
      kind: 'error';
      status: string;
      /** The number of the status in lib-ssh's table; absent in a record written before the table existed. */
      statusNumber?: number;
      message: string;
      details?: string;
      mitigations?: string[];
      resources?: string[];
      /** Where the setting keys that are links sit in the message and in each mitigation; a record without it draws them plain. */
      links?: {message?: TextRange[]; mitigations?: TextRange[][]};
    }
  | {kind: 'log'; text: string};

/** The hints of one resolve, which started at the ISO time `started`. */
export interface SessionRecord {
  started: string;
  hints: SessionHint[];
}

/** The records kept, oldest first, and the time of the last clear, which tells a record that was cleared from one that was lost. */
export interface HintStore {
  records: SessionRecord[];
  /** The ISO time the store was last cleared; none before the first clear. */
  clearedAt?: string;
}

/** How many records the store keeps. */
const RECORDS_KEPT = 2;

/** `ExtensionContext.globalState`, narrowed: only the earlier version's hints are read from it. */
export interface HintMemento {
  get(key: string): unknown;
}

/** The hints of every window, as one window reads and writes them. */
export interface HintEvents {
  /** The records kept now, as the files of every window hold them. */
  read(): HintStore;
  /** Keeps `record` as this window's latest state of its resolve. */
  record(record: SessionRecord): Promise<void>;
  /** Hides every record that started at or before `clearedAt`, in every window. */
  clear(clearedAt: string): Promise<void>;
}

/** One change to the hints, as a window's file keeps it. */
type HintEvent =
  | {kind: 'record'; record: SessionRecord; time: number}
  | {kind: 'clear'; clearedAt: string; time: number; earlier?: true};

/** What an event is about: one record by its start, the clear of this version, or the clear of the earlier one. */
function keyOf(event: HintEvent): string {
  if (event.kind === 'record') {
    return `record ${event.record.started}`;
  }
  return event.earlier === true ? 'clear earlier' : 'clear';
}

/** The hint a stored value holds, when its kind is one we write. */
function hintOf(value: unknown): SessionHint | undefined {
  return isRecord(value) &&
    (value.kind === 'environment' ||
      value.kind === 'error' ||
      value.kind === 'log')
    ? (value as unknown as SessionHint)
    : undefined;
}

/** The record a stored value holds: its start and the hints that fit, or none when it has no start. */
function recordOf(value: unknown): SessionRecord | undefined {
  return isRecord(value) &&
    typeof value.started === 'string' &&
    Array.isArray(value.hints)
    ? {
        started: value.started,
        hints: value.hints.flatMap(hint => hintOf(hint) ?? []),
      }
    : undefined;
}

/** The event a file's value holds, when every member fits. */
function eventOf(value: unknown): HintEvent | undefined {
  if (!isRecord(value) || typeof value.time !== 'number') {
    return undefined;
  }
  if (value.kind === 'clear' && typeof value.clearedAt === 'string') {
    return {kind: 'clear', clearedAt: value.clearedAt, time: value.time};
  }
  const record = value.kind === 'record' ? recordOf(value.record) : undefined;
  return record === undefined
    ? undefined
    : {kind: 'record', record, time: value.time};
}

/**
 * The earlier version's store as events, the oldest of all, each at time 0: its records, and the time it was cleared
 * as a clear of its own. A malformed value is no store.
 */
function earlierEvents(memento: HintMemento): HintEvent[] {
  const stored = memento.get(EARLIER_KEY);
  if (!isRecord(stored)) {
    return [];
  }
  const records = Array.isArray(stored.records)
    ? stored.records.flatMap(value => {
        const record = recordOf(value);
        return record === undefined
          ? []
          : [{kind: 'record' as const, record, time: 0}];
      })
    : [];
  return typeof stored.clearedAt === 'string'
    ? [
        ...records,
        {
          kind: 'clear',
          clearedAt: stored.clearedAt,
          time: 0,
          earlier: true,
        },
      ]
    : records;
}

/** What a window's file keeps when it writes: its newest clear and the records the store would show of its own. */
function keptEvents(events: readonly HintEvent[]): HintEvent[] {
  const records = events
    .filter(event => event.kind === 'record')
    .sort((first, second) =>
      first.record.started.localeCompare(second.record.started),
    )
    .slice(-RECORDS_KEPT);
  const clears = events.filter(event => event.kind === 'clear');
  return [...clears, ...records];
}

/** The hints of one window: `session` names its own file in `folder`, written with `files` at the times `now` gives. */
export function hintEventsOf(options: {
  folder: string;
  session: string;
  files: EventFiles;
  earlier: HintMemento;
  now: () => number;
}): HintEvents {
  const {folder, session, files, earlier, now} = options;
  const events = eventStoreOf<HintEvent>({
    folder,
    session,
    files,
    now,
    keyOf,
    parse: eventOf,
    earlier: () => earlierEvents(earlier),
    prune: keptEvents,
  });
  return {
    read: () => {
      const winners = [...events.winners().values()].map(each => each.event);
      const clearedAt = winners
        .flatMap(event => (event.kind === 'clear' ? [event.clearedAt] : []))
        .sort()
        .at(-1);
      const records = winners
        .flatMap(event => (event.kind === 'record' ? [event.record] : []))
        .filter(record => clearedAt === undefined || record.started > clearedAt)
        .sort((first, second) => first.started.localeCompare(second.started))
        .slice(-RECORDS_KEPT);
      return clearedAt === undefined ? {records} : {records, clearedAt};
    },
    record: record => events.append([{kind: 'record', record, time: now()}]),
    clear: clearedAt =>
      events.append([{kind: 'clear', clearedAt, time: now()}]),
  };
}
