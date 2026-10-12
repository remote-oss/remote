/**
 * @fileoverview The connection hints the extension keeps for its troubleshooting view: the records of the two most
 * recent resolves, oldest first. Every function returns a new store and changes nothing it is given.
 */

type SessionHint =
  | {kind: 'environment'; message: string; details?: string}
  | {
      kind: 'error';
      status: string;
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

/** The records kept, oldest first. */
export interface HintStore {
  records: SessionRecord[];
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
  const same = store.records.findIndex(
    stored => stored.started === record.started,
  );
  return same === -1
    ? {records: [...store.records, record].slice(-RECORDS_KEPT)}
    : {
        records: store.records.map((stored, index) =>
          index === same ? record : stored,
        ),
      };
}

/** A store with no record, whatever `store` held. */
export function clearAll(store: HintStore): HintStore {
  return {records: store.records.slice(store.records.length)};
}
