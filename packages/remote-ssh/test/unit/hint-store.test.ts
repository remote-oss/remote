import {deepStrictEqual, notStrictEqual} from 'node:assert';
import {
  addHint,
  clearAll,
  isGone,
  storeHolds,
  storeMerged,
  emptyHintStore,
  type HintStore,
  type SessionRecord,
} from '../../src/diagnostics/hint-store.ts';

function recordAt(
  started: string,
  hints: SessionRecord['hints'] = [{kind: 'log', text: 'log'}],
): SessionRecord {
  return {started, hints};
}

const first = recordAt('2026-10-08T10:00:00Z');
const second = recordAt('2026-10-08T11:00:00Z');
const third = recordAt('2026-10-08T12:00:00Z');
const fourth = recordAt('2026-10-08T13:00:00Z');

function storeOf(...records: SessionRecord[]): HintStore {
  return records.reduce(addHint, emptyHintStore());
}

function frozenStore(...records: SessionRecord[]): HintStore {
  return Object.freeze({
    records: Object.freeze([...records]) as SessionRecord[],
  });
}

describe('the hint store (card connect-04 table)', () => {
  it('F-2605.AC-16: a new store is empty', () => {
    deepStrictEqual(emptyHintStore(), {records: []});
  });

  it('F-2605.AC-16: two new stores are different objects', () => {
    notStrictEqual(emptyHintStore(), emptyHintStore());
  });

  it('F-2605.AC-16: the first record is the only one', () => {
    deepStrictEqual(storeOf(first).records, [first]);
  });

  it('F-2605.BR-10: records stay oldest first', () => {
    deepStrictEqual(storeOf(first, second).records, [first, second]);
  });

  it('F-2605.AC-16: a third record drops the first', () => {
    deepStrictEqual(storeOf(first, second, third).records, [second, third]);
  });

  it('F-2605.BR-10: a fourth record leaves the two newest', () => {
    deepStrictEqual(storeOf(first, second, third, fourth).records, [
      third,
      fourth,
    ]);
  });

  it('F-2605.BR-10 (provisional): the order is the order of the calls, not of the start times', () => {
    deepStrictEqual(storeOf(second, first).records, [second, first]);
  });

  it('F-2605.BR-10: adding to a frozen store returns a new store', () => {
    const frozen = frozenStore(first, second);
    notStrictEqual(addHint(frozen, third), frozen);
  });

  it('F-2605.BR-10: adding to a frozen store leaves its records alone', () => {
    const frozen = frozenStore(first, second);
    addHint(frozen, third);
    deepStrictEqual(frozen.records, [first, second]);
  });

  it('F-2605.AC-17: a record keeps all of its hints in order', () => {
    const hints: SessionRecord['hints'] = [
      ...Array.from({length: 23}, (ignored, index) => ({
        kind: 'environment' as const,
        message: `setting ${String(index)}`,
      })),
      {kind: 'environment', message: 'editor version', details: '1.2.3'},
      {kind: 'environment', message: 'extension version'},
      {kind: 'environment', message: 'platform'},
      {
        kind: 'error',
        status: 'OfflineError',
        message: 'Error: OfflineError',
        details: 'The connection timed out.',
      },
      {kind: 'log', text: 'the log'},
    ];
    deepStrictEqual(storeOf(recordAt('t', hints)).records[0]?.hints, hints);
  });

  it('F-2605.AC-17: an error hint keeps its lists and has no details', () => {
    const hints: SessionRecord['hints'] = [
      {
        kind: 'error',
        status: 'S',
        message: 'm',
        mitigations: ['m1', 'm2'],
        resources: ['r1'],
      },
    ];
    deepStrictEqual(storeOf(recordAt('t', hints)).records[0]?.hints, hints);
  });

  it('F-2605.BR-9: a long log hint is not truncated', () => {
    const text = 'x'.repeat(30_000);
    deepStrictEqual(
      storeOf(recordAt('t', [{kind: 'log', text}])).records[0]?.hints,
      [{kind: 'log', text}],
    );
  });

  it('F-2605.AC-17: a resolve that never ended gets no log hint', () => {
    const hints: SessionRecord['hints'] = [
      {kind: 'environment', message: 'e'},
      {kind: 'error', status: 'S', message: 'm'},
    ];
    deepStrictEqual(storeOf(recordAt('t', hints)).records[0]?.hints, hints);
  });

  it('F-2605.6.4: a success without an error hint is stored as given', () => {
    const hints: SessionRecord['hints'] = [
      {kind: 'environment', message: 'e'},
      {kind: 'log', text: 'l'},
    ];
    deepStrictEqual(storeOf(recordAt('t', hints)).records[0]?.hints, hints);
  });

  it('F-2605.7.E2: hints are stored in the order they were given', () => {
    const hints: SessionRecord['hints'] = [
      {kind: 'environment', message: 'e'},
      {kind: 'log', text: 'l'},
      {kind: 'error', status: 'S', message: 'm'},
    ];
    deepStrictEqual(storeOf(recordAt('t', hints)).records[0]?.hints, hints);
  });

  it('F-2605.BR-12 / F-2605.AC-20: a cleared store has no record and says when it was cleared', () => {
    deepStrictEqual(clearAll('2026-11-02T00:00:09.000Z'), {
      records: [],
      clearedAt: '2026-11-02T00:00:09.000Z',
    });
  });

  it('F-2605.AC-22 (c2326-cleared-at): a record added to a cleared store keeps the time of the clear', () => {
    deepStrictEqual(addHint(clearAll('2026-11-02T00:00:09.000Z'), first), {
      records: [first],
      clearedAt: '2026-11-02T00:00:09.000Z',
    });
  });

  it('F-2605.AC-22 (c2326-is-gone): a record is gone on purpose when the store was cleared after it began or holds two newer records, and a record missing otherwise is lost', () => {
    const early = recordAt('2026-11-02T00:00:01.000Z', []);
    const cleared = {...clearAll('2026-11-02T00:00:09.000Z')};
    const newer = storeOf(
      recordAt('2026-11-02T00:00:05.000Z', []),
      recordAt('2026-11-02T00:00:06.000Z', []),
    );
    deepStrictEqual(
      [
        isGone(cleared, early.started),
        isGone(newer, early.started),
        isGone(
          storeOf(recordAt('2026-11-02T00:00:05.000Z', [])),
          early.started,
        ),
        isGone(emptyHintStore(), early.started),
        isGone(undefined, early.started),
        isGone(clearAll('2026-11-02T00:00:00.000Z'), early.started),
      ],
      [true, true, false, false, false, false],
    );
  });

  it('F-2605.AC-22: a record added after clearing is the only one', () => {
    deepStrictEqual(
      addHint(clearAll('2026-11-02T00:00:09.000Z'), first).records,
      [first],
    );
  });

  it('F-2605.AC-16: records added after clearing start a new window of two', () => {
    deepStrictEqual(
      [third, fourth, first].reduce(
        addHint,
        clearAll('2026-11-02T00:00:09.000Z'),
      ).records,
      [fourth, first],
    );
  });

  describe('a record that started at the same time as a stored one (card connect-12)', () => {
    const secondAgain = recordAt('2026-10-08T11:00:00Z', [
      {kind: 'log', text: 'again'},
    ]);
    const firstAgain = recordAt('2026-10-08T10:00:00Z', [
      {kind: 'log', text: 'again'},
    ]);

    it('F-2605.BR-10 (O1): takes the place of the newest', () => {
      deepStrictEqual(addHint(storeOf(first, second), secondAgain).records, [
        first,
        secondAgain,
      ]);
    });

    it('F-2605.BR-10 (O1): takes the place of the oldest', () => {
      deepStrictEqual(addHint(storeOf(first, second), firstAgain).records, [
        firstAgain,
        second,
      ]);
    });

    it('F-2605.BR-10 (O1): takes the place of the only record', () => {
      deepStrictEqual(addHint(storeOf(first), firstAgain).records, [
        firstAgain,
      ]);
    });

    it('F-2605.BR-10 (O1): leaves a frozen store alone', () => {
      const frozen = frozenStore(first, second);
      addHint(frozen, secondAgain);
      deepStrictEqual(frozen.records, [first, second]);
    });

    it('F-2605.BR-10 (O1): returns a new store for a frozen store', () => {
      const frozen = frozenStore(first, second);
      notStrictEqual(addHint(frozen, secondAgain), frozen);
    });
  });

  it('F-2605.BR-9 (c2326-holds): a store holds a record write when it has the newest record with the same hints, whatever else it has, and a clear write when it was cleared at that time or later', () => {
    const own = recordAt('2026-11-02T00:00:05.000Z', [
      {kind: 'log', text: 'l'},
    ]);
    const other = recordAt('2026-11-02T00:00:06.000Z', []);
    deepStrictEqual(
      [
        storeHolds(storeOf(own, other), storeOf(own)),
        storeHolds(storeOf(recordAt(own.started, [])), storeOf(own)),
        storeHolds(emptyHintStore(), storeOf(own)),
        storeHolds(undefined, storeOf(own)),
        storeHolds(
          clearAll('2026-11-02T00:00:09.000Z'),
          clearAll('2026-11-02T00:00:09.000Z'),
        ),
        storeHolds(
          clearAll('2026-11-02T00:00:10.000Z'),
          clearAll('2026-11-02T00:00:09.000Z'),
        ),
        storeHolds(emptyHintStore(), clearAll('2026-11-02T00:00:09.000Z')),
        storeHolds(clearAll('2026-11-02T00:00:09.000Z'), emptyHintStore()),
        storeHolds(storeOf(own), clearAll('2026-11-02T00:00:09.000Z')),
      ],
      [true, false, false, false, true, true, false, true, false],
    );
  });

  it('F-2605.BR-9 (c2326-merged): a record is put into what was read and what another window wrote stays; a clear is put in as its time and removes the records that began before it', () => {
    const own = recordAt('2026-11-02T00:00:05.000Z', []);
    const other = recordAt('2026-11-02T00:00:06.000Z', []);
    const later = recordAt('2026-11-02T00:00:20.000Z', []);
    deepStrictEqual(
      [
        storeMerged(storeOf(other), storeOf(own)).records,
        storeMerged(undefined, storeOf(own)).records,
        storeMerged(
          storeOf(own, other, later),
          clearAll('2026-11-02T00:00:10.000Z'),
        ),
        storeMerged(clearAll('2026-11-02T00:00:30.000Z'), storeOf(own))
          .clearedAt,
      ],
      [
        [other, own],
        [own],
        {records: [later], clearedAt: '2026-11-02T00:00:10.000Z'},
        '2026-11-02T00:00:30.000Z',
      ],
    );
  });
});
