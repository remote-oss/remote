/**
 * @fileoverview acceptance-retry: the automatic retry of the acceptance run when the editor window was reported
 * unresponsive (card tooling-01).
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  HANG_MARKERS,
  runAndCollect,
  runWithRetry,
  shouldRetry,
  type AttemptResult,
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

it('HANG_MARKERS contains exactly the one marker', () => {
  deepStrictEqual(HANG_MARKERS, ['CodeWindow: detected unresponsive']);
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
