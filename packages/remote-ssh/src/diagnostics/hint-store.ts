/**
 * @fileoverview The connection hints the extension keeps for its troubleshooting view: the records of the two most
 * recent resolves, oldest first. Every function returns a new store and changes nothing it is given.
 */

/**
 * The global-state key the session hints live under: the recorder writes it and the clear command deletes it, so
 * both name it in one place.
 */
export const HINT_STORE_KEY = 'remote.ssh.hints';

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

/** A store with no record. */
export function emptyHintStore(): HintStore {
  return {records: []};
}

/**
 * `store` with `record` as its newest record, the oldest ones beyond the two kept dropped; a record that started at the
 * same time as one in the store takes its place.
 */
export function addHint(store: HintStore, record: SessionRecord): HintStore {
  const cleared =
    store.clearedAt === undefined ? {} : {clearedAt: store.clearedAt};
  const same = store.records.findIndex(
    stored => stored.started === record.started,
  );
  return same === -1
    ? {
        records: [...store.records, record].slice(-RECORDS_KEPT),
        ...cleared,
      }
    : {
        records: store.records.map((stored, index) =>
          index === same ? record : stored,
        ),
        ...cleared,
      };
}

/** A store with no record that says it was cleared at the ISO time `clearedAt`. */
export function clearAll(clearedAt: string): HintStore {
  return {records: [], clearedAt};
}

/**
 * Whether the record that started at `started` is gone on purpose from `store`: the store was cleared after the record
 * began, or it already holds the two newer records the newest-two rule keeps. A record that is missing otherwise was
 * lost to an older copy of the store.
 */
export function isGone(store: HintStore | undefined, started: string): boolean {
  if (store === undefined) {
    return false;
  }
  const newer = store.records.filter(each => each.started > started);
  return (
    (store.clearedAt !== undefined && store.clearedAt > started) ||
    newer.length >= RECORDS_KEPT
  );
}

/**
 * Whether `read` holds what the write of `latest` was for. For a record: the store holds the newest record of `latest`
 * with the same hints, whatever else it holds. For a clear: the store was cleared at that time or later.
 */
export function storeHolds(
  read: HintStore | undefined,
  latest: HintStore,
): boolean {
  const newest = latest.records.at(-1);
  if (newest === undefined) {
    return (
      read?.clearedAt !== undefined &&
      read.clearedAt >= (latest.clearedAt ?? '')
    );
  }
  const found = read?.records.find(each => each.started === newest.started);
  return (
    found !== undefined && JSON.stringify(found) === JSON.stringify(newest)
  );
}

/**
 * `read` with the part of `latest` that was written put into it: the newest record of `latest`, or the time of its
 * clear and the removal of the records that began before it. What another window wrote into `read` stays.
 */
export function storeMerged(
  read: HintStore | undefined,
  latest: HintStore,
): HintStore {
  const base = read ?? emptyHintStore();
  const clearedAt = [base.clearedAt, latest.clearedAt]
    .filter((each): each is string => each !== undefined)
    .sort()
    .at(-1);
  const cleared = clearedAt === undefined ? {} : {clearedAt};
  const newest = latest.records.at(-1);
  if (newest === undefined) {
    return {
      records: base.records.filter(
        each => clearedAt === undefined || each.started > clearedAt,
      ),
      ...cleared,
    };
  }
  return {...addHint(base, newest), ...cleared};
}
