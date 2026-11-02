import {deepStrictEqual, throws} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {
  analyzerArguments,
  findingsOf,
  pinnedAnalyzerVersion,
} from './check-powershell.ts';

const PINNED = pinnedAnalyzerVersion(
  readFileSync(path.join(import.meta.dirname, 'install-pwsh'), 'utf8'),
);

describe('check-powershell', () => {
  describe('analyzerArguments', () => {
    it('quotes the folder as one PowerShell string', () => {
      deepStrictEqual(
        analyzerArguments("/tmp/it's here", '1.25.0')
          .at(-1)
          ?.includes("'/tmp/it''s here'"),
        true,
      );
    });

    it('loads the pinned module before it analyses', () => {
      deepStrictEqual(
        analyzerArguments('/tmp/x', '1.25.0')
          .at(-1)
          ?.startsWith(
            "Import-Module PSScriptAnalyzer -RequiredVersion '1.25.0';",
          ),
        true,
      );
    });
  });

  describe('pinnedAnalyzerVersion', () => {
    it('reads the PSSA_VERSION line', () => {
      deepStrictEqual(
        pinnedAnalyzerVersion('set -eu\nPSSA_VERSION=1.25.0\nOTHER=1\n'),
        '1.25.0',
      );
    });

    it('refuses a script that pins none', () => {
      throws(() => pinnedAnalyzerVersion('set -eu\n'), /pins no PSSA_VERSION/);
    });
  });

  describe('findingsOf', () => {
    it('reads no findings', () => {
      deepStrictEqual(findingsOf('[]'), []);
    });

    it('reads each finding as file, line and message', () => {
      deepStrictEqual(
        findingsOf('[{"file":"probe.ps1","line":3,"message":"not in 5.1"}]'),
        ['probe.ps1:3: not in 5.1'],
      );
    });

    it('refuses output that is not a list', () => {
      throws(() => findingsOf('{"file":"probe.ps1"}'), /no list of findings/);
    });

    it('refuses a finding without its fields', () => {
      throws(() => findingsOf('[{"file":"probe.ps1"}]'), /no list of findings/);
    });

    it('refuses an entry that is not an object', () => {
      throws(() => findingsOf('[null]'), /no list of findings/);
    });
  });

  describe('the analyser, run', function () {
    this.timeout(60000);

    it('finds syntax that Windows PowerShell 5.1 lacks', () => {
      const folder = mkdtempSync(path.join(tmpdir(), 'check-powershell-'));
      try {
        writeFileSync(
          path.join(folder, 'step.ps1'),
          '$a = $null\n$b = $a ?? 1\n',
        );
        const analysis = spawnSync('pwsh', analyzerArguments(folder, PINNED), {
          encoding: 'utf8',
        });
        deepStrictEqual(
          findingsOf(analysis.stdout).map(finding => finding.split(':')[0]),
          ['step.ps1'],
        );
      } finally {
        rmSync(folder, {recursive: true, force: true});
      }
    });
  });
});
