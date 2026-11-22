/**
 * @fileoverview The merge of the viewport reads of a virtualized list (card #2960): a read that starts mid-list is
 * corrected by the wheel to the top, and a walk that never reaches the top misses the rows above it.
 */

import {deepStrictEqual, notDeepStrictEqual} from 'node:assert';
import {mergeReads, wheelDirection, type ViewRowRead} from './view-rows.ts';

/** A row of the fake list. */
function sampleRow(label: string, level = 2): ViewRowRead {
  return {label, description: '', level, expanded: null};
}

describe('the merge of the viewport reads of a virtualized list (card #2960)', () => {
  // The fake list has six rows, two drawn at a time, and the fresh walk reads it from its top.
  const FRESH: ReadonlyArray<readonly ViewRowRead[]> = [
    [sampleRow('a'), sampleRow('b')],
    [sampleRow('b'), sampleRow('c')],
    [sampleRow('c'), sampleRow('d')],
    [sampleRow('d'), sampleRow('e')],
    [sampleRow('e'), sampleRow('f')],
  ];

  it('a list scrolled mid-way reads the same rows as a fresh one', () => {
    // The read stands mid-list, but the expression first wheels to the top; the page feeds the merge only the
    // reads after the top, so they stand as a fresh walk: the top's read, the walk down, and the read that closes
    // it, which shows the last pair twice.
    const scrolled: ReadonlyArray<readonly ViewRowRead[]> = [
      ...FRESH,
      [sampleRow('e'), sampleRow('f')],
    ];
    deepStrictEqual(mergeReads(scrolled), mergeReads(FRESH));
  });

  it('a walk that never reaches the top misses the rows above it', () => {
    const midOnly: ReadonlyArray<readonly ViewRowRead[]> = [
      [sampleRow('c'), sampleRow('d')],
      [sampleRow('d'), sampleRow('e')],
      [sampleRow('e'), sampleRow('f')],
    ];
    notDeepStrictEqual(mergeReads(midOnly), mergeReads(FRESH));
  });

  it('a label that repeats at two levels keeps both rows', () => {
    const reads: ReadonlyArray<readonly ViewRowRead[]> = [
      [sampleRow('ssh', 1), sampleRow('ssh', 2)],
      [sampleRow('ssh', 2), sampleRow('tty', 2)],
    ];
    deepStrictEqual(mergeReads(reads), [
      sampleRow('ssh', 1),
      sampleRow('ssh', 2),
      sampleRow('tty', 2),
    ]);
  });
});

describe('the direction of a wheel of a virtualized list, told by its labels (card #2960)', () => {
  it('a wheel that reveals the rows below reads down', () => {
    deepStrictEqual(
      wheelDirection(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'e']),
      'down',
    );
  });

  it('a wheel that reveals the rows above reads up', () => {
    deepStrictEqual(
      wheelDirection(['c', 'd', 'e', 'f'], ['b', 'c', 'd', 'e']),
      'up',
    );
  });

  it('labels that show no moved edge read neither', () => {
    deepStrictEqual(
      wheelDirection(['a', 'b', 'c'], ['a', 'b', 'c']),
      undefined,
    );
  });

  it('a pinned header left in the labels can hide the wheel, so the page leaves it out', () => {
    deepStrictEqual(
      wheelDirection(['ssh', 'a', 'b', 'c'], ['ssh', 'b', 'c', 'd']),
      undefined,
    );
  });
});
