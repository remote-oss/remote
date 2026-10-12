import {deepStrictEqual, notStrictEqual} from 'node:assert';
import {
  addHint,
  clearAll,
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

  it('F-2605.BR-12 / F-2605.AC-20: clearing removes both records', () => {
    deepStrictEqual(clearAll(storeOf(first, second)), {records: []});
  });

  it('F-2605.AC-21: clearing an empty store gives an empty store', () => {
    deepStrictEqual(clearAll(emptyHintStore()), {records: []});
  });

  it('F-2605.BR-12: clearing twice gives an empty store both times', () => {
    const once = clearAll(storeOf(first));
    deepStrictEqual([once, clearAll(once)], [{records: []}, {records: []}]);
  });

  it('F-2605.6.6: clearing a frozen store returns a new store', () => {
    const frozen = frozenStore(first, second);
    notStrictEqual(clearAll(frozen), frozen);
  });

  it('F-2605.6.6: clearing a frozen store leaves its records alone', () => {
    const frozen = frozenStore(first, second);
    clearAll(frozen);
    deepStrictEqual(frozen.records, [first, second]);
  });

  it('F-2605.AC-22: a record added after clearing is the only one', () => {
    deepStrictEqual(addHint(clearAll(storeOf(first, second)), first).records, [
      first,
    ]);
  });

  it('F-2605.AC-16: records added after clearing start a new window of two', () => {
    deepStrictEqual(
      [third, fourth, first].reduce(addHint, clearAll(storeOf(first, second)))
        .records,
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
});
