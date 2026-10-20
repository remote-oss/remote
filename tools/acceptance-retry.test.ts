/**
 * @fileoverview acceptance-retry: the automatic retry of the acceptance run when the editor window was reported
 * unresponsive (card tooling-01), and the limits that end a launch whose editor stays after its results or that
 * prints nothing.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  boundReached,
  launchLimits,
  runAndCollect,
  runWithRetry,
  shouldRetry,
  type AttemptResult,
  type LaunchLimits,
} from './acceptance.ts';

/** Runs `run` from a scripted list of attempt results, repeating the last one, and counts the calls. */
function scripted(results: AttemptResult[]) {
  let calls = 0;

  /** The result at `index`, or the last one when the list runs out; the test's list is never empty. */
  function take(index: number): AttemptResult {
    const result = results[Math.min(index, results.length - 1)];
    if (result === undefined) {
      throw new Error('no scripted attempt result');
    }
    return result;
  }

  function attempt(): Promise<AttemptResult> {
    const result = take(calls);
    calls += 1;
    return Promise.resolve(result);
  }
  function called(): number {
    return calls;
  }
  return {attempt, called};
}

describe('shouldRetry', () => {
  it("shouldRetry(1, 1, '... CodeWindow: detected unresponsive ...') -> true", () => {
    strictEqual(
      shouldRetry(1, 1, `a CodeWindow: detected unresponsive b`),
      true,
    );
  });

  it('shouldRetry(2, 1, same) -> false (no third attempt)', () => {
    strictEqual(
      shouldRetry(2, 1, `a CodeWindow: detected unresponsive b`),
      false,
    );
  });

  it('shouldRetry(1, 0, same) -> false (success is never retried)', () => {
    strictEqual(
      shouldRetry(1, 0, `a CodeWindow: detected unresponsive b`),
      false,
    );
  });

  it("shouldRetry(1, 1, 'assertion failed: expected 3 to equal 4') -> false (a real failure is not retried)", () => {
    strictEqual(
      shouldRetry(1, 1, 'assertion failed: expected 3 to equal 4'),
      false,
    );
  });

  it("shouldRetry(1, 1, '') -> false", () => {
    strictEqual(shouldRetry(1, 1, ''), false);
  });
});

describe('runWithRetry', () => {
  it('runWithRetry with run results [hang exit 1, exit 0] -> returns 0, two runs, one log line with attempt 1', async () => {
    const {attempt, called} = scripted([
      {exitCode: 1, output: 'x CodeWindow: detected unresponsive y'},
      {exitCode: 0, output: ''},
    ]);
    const lines: string[] = [];
    const status = await runWithRetry(attempt, line => lines.push(line));
    deepStrictEqual(
      [status, called(), lines],
      [
        0,
        2,
        ['acceptance: editor window unresponsive on attempt 1; retrying once'],
      ],
    );
  });

  it('runWithRetry with run results [hang exit 1, hang exit 1] -> returns 1, two runs, one log line', async () => {
    const {attempt, called} = scripted([
      {exitCode: 1, output: 'x CodeWindow: detected unresponsive y'},
      {exitCode: 1, output: 'x CodeWindow: detected unresponsive y'},
    ]);
    const lines: string[] = [];
    const status = await runWithRetry(attempt, line => lines.push(line));
    deepStrictEqual(
      [status, called(), lines],
      [
        1,
        2,
        ['acceptance: editor window unresponsive on attempt 1; retrying once'],
      ],
    );
  });

  it('runWithRetry with run results [exit 0] -> returns 0, one run, no log line', async () => {
    const {attempt, called} = scripted([{exitCode: 0, output: ''}]);
    const lines: string[] = [];
    const status = await runWithRetry(attempt, line => lines.push(line));
    deepStrictEqual([status, called(), lines], [0, 1, []]);
  });

  it('runWithRetry with run results [assertion exit 1] -> returns 1, one run, no log line', async () => {
    const {attempt, called} = scripted([
      {exitCode: 1, output: 'assertion failed: expected 3 to equal 4'},
    ]);
    const lines: string[] = [];
    const status = await runWithRetry(attempt, line => lines.push(line));
    deepStrictEqual([status, called(), lines], [1, 1, []]);
  });
});

describe('a launch past its limits', () => {
  /** Small limits for a test, whose leftovers are a line in `ended`. */
  function limits(ended: string[]): LaunchLimits {
    return {
      afterResultsMilliseconds: 300,
      quietMilliseconds: 600,
      checkMilliseconds: 50,
      endLeftovers: () => {
        ended.push('leftovers');
      },
    };
  }

  it("a child that prints passing results and stays: killed after the grace, its leftovers ended, and the rows' pass stands", async () => {
    const ended: string[] = [];
    const result = await runAndCollect(
      process.execPath,
      [
        '-e',
        'process.stdout.write("  3 passing (2s)\\n"); setTimeout(() => process.stdout.write("late\\n"), 100); setInterval(() => {}, 1000)',
      ],
      {},
      () => undefined,
      limits(ended),
    );
    deepStrictEqual(
      [result, ended],
      [
        {
          exitCode: 0,
          output:
            "  3 passing (2s)\nlate\nacceptance: the editor had not ended 0.3 s after its results; the launch's processes were ended, and its rows' result stands\n",
        },
        ['leftovers'],
      ],
    );
  });

  it("a child that prints failing results and stays: killed after the grace, and the rows' failure stands", async () => {
    const result = await runAndCollect(
      process.execPath,
      [
        '-e',
        'process.stdout.write("  2 passing (2s)\\n  1 failing\\n"); setInterval(() => {}, 1000)',
      ],
      {},
      () => undefined,
      limits([]),
    );
    deepStrictEqual(result.exitCode, 1);
  });

  it('a child that prints nothing: killed after the quiet limit', async () => {
    const ended: string[] = [];
    const result = await runAndCollect(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {},
      () => undefined,
      limits(ended),
    );
    deepStrictEqual(
      [result, ended],
      [
        {
          exitCode: 1,
          output:
            "acceptance: nothing was printed for 0.6 s; the launch's processes were ended\n",
        },
        ['leftovers'],
      ],
    );
  });

  it('a child that prints its results and ends in time: its own code, nothing ended', async () => {
    const ended: string[] = [];
    const result = await runAndCollect(
      process.execPath,
      [
        '-e',
        'process.stdout.write("  1 passing (1s)\\n"); process.exitCode = 3',
      ],
      {},
      () => undefined,
      limits(ended),
    );
    deepStrictEqual(
      [result, ended],
      [{exitCode: 3, output: '  1 passing (1s)\n'}, []],
    );
  });

  it('boundReached: within both limits, past the grace after the results, past the quiet limit', () => {
    const bounds = {
      afterResultsMilliseconds: 60_000,
      quietMilliseconds: 1_200_000,
    };
    deepStrictEqual(
      [
        boundReached(bounds, 1_000_000, 999_000, 950_000),
        boundReached(bounds, 1_010_000, 1_005_000, 950_000),
        boundReached(bounds, 1_300_000, 100_000, undefined),
      ],
      [
        undefined,
        'the editor had not ended 60 s after its results',
        'nothing was printed for 1200 s',
      ],
    );
  });

  it("launchLimits: the leftovers are the editors on the run's profile folder, killed by their command line", () => {
    const calls: string[][] = [];
    const limitsOfRun = launchLimits(
      '/tmp/acceptance-7-abc',
      (program, programArguments) => {
        calls.push([program, ...programArguments]);
        return {status: 1, stdout: '', stderr: ''};
      },
    );
    limitsOfRun.endLeftovers();
    deepStrictEqual(
      [
        limitsOfRun.afterResultsMilliseconds,
        limitsOfRun.quietMilliseconds,
        calls,
      ],
      [
        180_000,
        1_200_000,
        [
          [
            'pkill',
            '-KILL',
            '-f',
            '--',
            '/tmp/acceptance-7-abc/user-data( |$)',
          ],
        ],
      ],
    );
  });
});

it('runAndCollect with a child that writes in two parts and exits 4: both parts echoed in order, output kept whole, the code returned', async () => {
  const chunks: string[] = [];
  const result = await runAndCollect(
    process.execPath,
    [
      '-e',
      'process.stdout.write("part1 "); setTimeout(() => process.stdout.write("part2\\n"), 50); process.exitCode = 4',
    ],
    {},
    chunk => {
      chunks.push(chunk);
    },
  );
  deepStrictEqual(
    [result, chunks.join('')],
    [{exitCode: 4, output: 'part1 part2\n'}, 'part1 part2\n'],
  );
});
