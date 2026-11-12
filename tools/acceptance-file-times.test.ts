/**
 * @fileoverview acceptance-file-times: the spec reporter that prints each test file's time when the run ends.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import Mocha from 'mocha';
import {
  fileTimeLine,
  'module.exports' as FileTimes,
} from './acceptance-file-times.ts';
import {REPOSITORY_ROOT} from './repository.ts';

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
      const result = spawnSync(
        process.execPath,
        [
          path.join(
            REPOSITORY_ROOT,
            'node_modules',
            'mocha',
            'bin',
            'mocha.js',
          ),
          '--no-config',
          '--extension',
          'ts',
          '--reporter',
          path.join(REPOSITORY_ROOT, 'tools', 'acceptance-file-times.ts'),
          '--spec',
          path.join(folder, 'first.test.ts'),
          '--spec',
          path.join(folder, 'second.test.ts'),
        ],
        {encoding: 'utf8'},
      );
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
