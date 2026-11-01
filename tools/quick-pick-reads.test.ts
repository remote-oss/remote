import {deepStrictEqual, throws} from 'node:assert';
import {
  combineQuickPickReads,
  type QuickPickRead,
  type QuickPickReadRow,
} from '../tests/acceptance/windows/renderer.ts';

function readRow(position: number, setSize: number): QuickPickReadRow {
  return {
    position,
    setSize,
    label: `row ${String(position)}`,
    description: '',
    detail: '',
    icons: [],
    buttons: [],
    focused: false,
  };
}

function read(positions: readonly number[], setSize: number): QuickPickRead {
  return {
    rows: positions.map(position => readRow(position, setSize)),
    setSize,
  };
}

describe('the whole quick pick out of its on-screen reads (card containers-125)', () => {
  it('returns a list of 17 in order from two reads of the 16 rows the virtualized list renders', () => {
    const all = combineQuickPickReads([
      read([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 17),
      read([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], 17),
    ]);
    deepStrictEqual(
      all.map(each => each.label),
      Array.from({length: 17}, (unused, index) => `row ${String(index + 1)}`),
    );
  });

  it('returns the set as read when every row is in view', () => {
    const all = combineQuickPickReads([read([1, 2, 3], 3)]);
    deepStrictEqual(
      all.map(each => each.label),
      ['row 1', 'row 2', 'row 3'],
    );
  });

  it('fails instead of passing short when the reads missed rows', () => {
    throws(
      () => combineQuickPickReads([read([1, 2, 3], 5), read([1, 2, 3], 5)]),
      /missed rows: 3 of 5/,
    );
  });

  it('fails when the set changes between its reads', () => {
    throws(
      () => combineQuickPickReads([read([1, 2], 2), read([1, 2], 3)]),
      /set changed mid-read: 2 rows, then 3/,
    );
  });

  it('fails when a row is out of its set', () => {
    throws(
      () => combineQuickPickReads([read([1, 2, 3], 2)]),
      /out of its set: position 3 of 2/,
    );
  });

  it('fails when the rows carry no set size', () => {
    throws(
      () =>
        combineQuickPickReads([
          {rows: [readRow(1, 2), readRow(2, 2)], setSize: Number.NaN},
        ]),
      /has no size/,
    );
  });
});
