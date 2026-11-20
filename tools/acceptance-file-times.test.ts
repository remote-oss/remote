/**
 * @fileoverview acceptance-file-times: the spec reporter that prints each test file's time when the run ends.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync, type SpawnSyncReturns} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Mocha from 'mocha';
import {
  failedLine,
  fileTimeLine,
  'module.exports' as FileTimes,
} from './acceptance-file-times.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** A mocha run of `specs` with the reporter, as the plain launches run it, and what it printed. */
function reportedRun(specs: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      path.join(REPOSITORY_ROOT, 'node_modules', 'mocha', 'bin', 'mocha.js'),
      '--no-config',
      '--extension',
      'ts',
      '--reporter',
      path.join(REPOSITORY_ROOT, 'tools', 'acceptance-file-times.ts'),
      ...specs.flatMap(spec => ['--spec', spec]),
    ],
    {encoding: 'utf8'},
  );
}

describe('acceptance-file-times (card tooling-159)', () => {
  it("tooling-159: the module's value is the reporter, mocha's spec reporter with the times beside it", () => {
    strictEqual(FileTimes.prototype instanceof Mocha.reporters.Spec, true);
  });

  it('tooling-159: a line names the suite folder and file, with the seconds to one decimal', () => {
    deepStrictEqual(
      fileTimeLine('/repo/tests/acceptance/containers/reuse.test.ts', 391.26),
      'acceptance: file containers/reuse.test.ts 391.3',
    );
  });

  it("#2901: a failed row's line names its suite folder, file and title, with the whole message", () => {
    const runnable = new Mocha.Test('c100-connected', () => undefined);
    runnable.file =
      '/repo/tests/acceptance/explorer-rows/active-folders.test.ts';
    deepStrictEqual(
      [
        failedLine(
          runnable,
          new Error('timed out waiting for a push\nthe inbox: none'),
        ),
        failedLine(runnable, 'a thrown string'),
      ],
      [
        'acceptance: failed explorer-rows/active-folders.test.ts: c100-connected: timed out waiting for a push\nthe inbox: none',
        'acceptance: failed explorer-rows/active-folders.test.ts: c100-connected: a thrown string',
      ],
    );
  });

  it("#2901: a mocha run with it prints a failed row's line as the row fails, before the next row runs", () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'file-times-'));
    try {
      writeFileSync(
        path.join(folder, 'failing.test.ts'),
        "describe('rows', () => { it('fails', () => { throw new Error('the reason'); }); it('later', () => {}); });\n",
      );
      const result = reportedRun([path.join(folder, 'failing.test.ts')]);
      const failed = result.stdout.indexOf(
        `acceptance: failed ${path.basename(folder)}/failing.test.ts: fails: the reason`,
      );
      deepStrictEqual(
        [
          result.status,
          failed >= 0,
          failed < result.stdout.indexOf('later'),
          failed < result.stdout.indexOf('1 failing'),
        ],
        [1, true, true, true],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it("tooling-159: a mocha run with it prints the spec report, then one line per file that holds its suites' hooks and tests", () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'file-times-'));
    try {
      writeFileSync(
        path.join(folder, 'first.test.ts'),
        "describe('one', () => { before(done => { setTimeout(done, 300); }); it('a', () => {}); });\n" +
          "describe('two', () => { it('b', () => {}); });\n",
      );
      writeFileSync(
        path.join(folder, 'second.test.ts'),
        "describe('three', () => { it('c', () => {}); });\n",
      );
      const result = reportedRun([
        path.join(folder, 'first.test.ts'),
        path.join(folder, 'second.test.ts'),
      ]);
      const lines = result.stdout
        .split('\n')
        .filter(line => line.startsWith('acceptance: file '));
      const folderName = path.basename(folder);
      deepStrictEqual(
        [
          result.status,
          result.stdout.includes('3 passing'),
          lines.map(line => line.replace(/ [\d.]+$/, '')),
          Number(lines[0]?.split(' ').at(-1)) >= 0.3,
        ],
        [
          0,
          true,
          [
            `acceptance: file ${folderName}/first.test.ts`,
            `acceptance: file ${folderName}/second.test.ts`,
          ],
          true,
        ],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
