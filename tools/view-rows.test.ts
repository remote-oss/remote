/**
 * @fileoverview The reads of a virtualized list's walk (card #2960): the merge of the viewport reads, where a read
 * that starts mid-list is corrected by the wheel to the top and a walk that never reaches the top misses the rows
 * above it, and the direction a wheel went, told by its labels; the sign of the wheel that stands the list at its
 * top stands on the direction its probe told, re-read while the list's rows are still filling (card #3000).
 */

import {deepStrictEqual, notDeepStrictEqual, rejects} from 'node:assert';
import {
  mergeReads,
  wheelDirection,
  wheelTopSign,
  type ViewRowRead,
  type WheelProbeRead,
} from './view-rows.ts';

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

  it('a row the reads show twice keeps the first read’s values at its first place', () => {
    // One read draws the row expanded with a description; the read that shows it again draws it collapsed with
    // another. The merge's one rule — the first read's values win — is what a pinned header the walk passes again
    // needs, so this row is the one a last-read-wins merge breaks.
    const reads: ReadonlyArray<readonly ViewRowRead[]> = [
      [
        sampleRow('ssh'),
        {label: 'tty', description: 'work', level: 2, expanded: true},
      ],
      [
        {label: 'tty', description: 'now idle', level: 2, expanded: false},
        sampleRow('modem'),
      ],
    ];
    deepStrictEqual(mergeReads(reads), [
      sampleRow('ssh'),
      {label: 'tty', description: 'work', level: 2, expanded: true},
      sampleRow('modem'),
    ]);
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

describe('the sign of the wheel that stands a virtualized list at its top (card #3000)', () => {
  /** A probe that answers each wheel with the read it stands at, in order, echoing the wheel's delta. */
  function scriptedProbe(reads: readonly WheelProbeRead[]) {
    let stands = 0;
    return (delta: number) => {
      const read = reads[stands];
      stands += 1;
      if (read === undefined) {
        throw new Error('the scripted probe ran out of reads');
      }
      return Promise.resolve({...read, delta});
    };
  }

  it('a list that fills after the first read tells its direction on the re-read', async () => {
    // The list fills while the first read stands: the viewport gains a row and its top does not shift, so the
    // labels tell no direction; the probe wheels the list again, and the shifted read tells it.
    const reads: readonly WheelProbeRead[] = [
      {delta: -400, moved: true, before: ['a', 'b'], after: ['a', 'b', 'c']},
      {
        delta: -400,
        moved: true,
        before: ['a', 'b', 'c'],
        after: ['b', 'c', 'd'],
      },
    ];
    deepStrictEqual(await wheelTopSign(scriptedProbe(reads)), 400);
  });

  it('a list that never stops filling names its reads when the direction still cannot be told', async () => {
    const reads: readonly WheelProbeRead[] = [
      {delta: -400, moved: true, before: ['h', 'i'], after: ['h', 'i', 'j']},
      {
        delta: -400,
        moved: true,
        before: ['h', 'i', 'j'],
        after: ['h', 'i', 'j', 'k'],
      },
      {
        delta: -400,
        moved: true,
        before: ['h', 'i', 'j', 'k'],
        after: ['h', 'i', 'j', 'k', 'l'],
      },
    ];
    await rejects(wheelTopSign(scriptedProbe(reads)), {
      message:
        'the wheel to the top still could not tell its direction after 3 reads, before [h, i, j, k], after [h, i, j, k, l]',
    });
  });
});
