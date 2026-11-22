import {deepStrictEqual} from 'node:assert';
import {labelsWithin} from '../tests/acceptance/windows/labels-wait.ts';

/** A clock that only a pause advances, a read that shows `labels` in turn, and the lines said. */
function waited(labels: Array<{indicator: string; title: string}>) {
  let now = 0;
  let reads = 0;
  const said: string[] = [];
  const result = labelsWithin(
    () => {
      const shown = labels[Math.min(reads, labels.length - 1)] ?? {
        indicator: '',
        title: '',
      };
      reads += 1;
      return Promise.resolve(shown);
    },
    'win',
    'SSH: harness',
    '[SSH: harness]',
    {
      now: () => now,
      pause: milliseconds => {
        now += milliseconds;
        return Promise.resolve();
      },
      report: line => said.push(line),
    },
  );
  return {result, said, readCount: () => reads};
}

const PENDING = {indicator: 'Opening Remote...', title: '[harness]'};
const SHOWN = {indicator: 'SSH: harness', title: '[SSH: harness]'};

describe('the wait for the labels a window shows of its host (card #2970)', () => {
  it('#2970: labels that read at once are returned after one read, and nothing is said', async () => {
    const attempt = waited([SHOWN]);
    deepStrictEqual(
      [(await attempt.result).reads, attempt.readCount(), attempt.said],
      ['[+0.0 s] indicator "SSH: harness", title "[SSH: harness]"', 1, []],
    );
  });

  it('#2970: labels that read late pass, and the wait says after how many seconds', async () => {
    const attempt = waited([PENDING, PENDING, PENDING, SHOWN]);
    const shown = await attempt.result;
    deepStrictEqual(
      [shown.indicator, shown.title, attempt.readCount(), attempt.said],
      [
        'SSH: harness',
        '[SSH: harness]',
        4,
        [
          'win: the labels read "SSH: harness" and "[SSH: harness]" only 1.5 s after the connect ended',
        ],
      ],
    );
  });

  it('#2970: labels that never read stop at the bound and name the last five reads with their times', async () => {
    const attempt = waited([PENDING]);
    const shown = await attempt.result;
    deepStrictEqual(
      [
        shown.indicator,
        attempt.readCount(),
        shown.reads.split('; ').length,
        shown.reads.split('; ').at(-1),
        attempt.said,
      ],
      [
        'Opening Remote...',
        21,
        5,
        '[+10.0 s] indicator "Opening Remote...", title "[harness]"',
        [],
      ],
    );
  });
});
