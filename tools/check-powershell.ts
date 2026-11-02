/**
 * @fileoverview check-powershell: the syntax check of the PowerShell bootstrap script (ADR-0013 decision 5). Every
 * rendered step in lib-server's golden folder, which the golden rows keep equal to the renderer, is analysed by
 * PSScriptAnalyzer for Windows PowerShell 5.1 compatibility. It needs `pwsh` and the module (`tools/install-pwsh`).
 *
 *     node tools/check-powershell.ts
 */

import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {isMainModule, messageOf, REPOSITORY_ROOT} from './repository.ts';

/** The folder of the rendered PowerShell steps, from the repository root. */
export const GOLDEN_POWERSHELL_FOLDER = path.join(
  'packages',
  'lib-server',
  'test',
  'unit',
  'golden',
  'powershell',
);

/** The PSScriptAnalyzer version `tools/install-pwsh` pins, from its `PSSA_VERSION=` line; throws when there is none. */
export function pinnedAnalyzerVersion(installScript: string): string {
  const pinned = /^PSSA_VERSION=([0-9.]+)$/m.exec(installScript)?.[1];
  if (pinned === undefined) {
    throw new Error('tools/install-pwsh pins no PSSA_VERSION');
  }
  return pinned;
}

/**
 * The pwsh arguments that load the pinned PSScriptAnalyzer, analyse every script under `folder` for 5.1, and print the
 * findings as one JSON array.
 */
export function analyzerArguments(folder: string, version: string): string[] {
  const command = [
    `Import-Module PSScriptAnalyzer -RequiredVersion '${version}'`,
    "$settings = @{IncludeRules = @('PSUseCompatibleSyntax'); Rules = @{PSUseCompatibleSyntax = @{Enable = $true; TargetVersions = @('5.1')}}}",
    `$findings = @(Invoke-ScriptAnalyzer -Path '${folder.replaceAll("'", "''")}' -Recurse -Settings $settings)`,
    'ConvertTo-Json -Compress -InputObject @($findings | ForEach-Object { @{file = $_.ScriptName; line = $_.Line; message = $_.Message} })',
  ].join('; ');
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
}

/** One finding as pwsh printed it. */
interface Finding {
  file: string;
  line: number;
  message: string;
}

function isFinding(value: unknown): value is Finding {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    typeof fields.file === 'string' &&
    typeof fields.line === 'number' &&
    typeof fields.message === 'string'
  );
}

/** The findings pwsh printed, as `file:line: message`; throws when the output isn't an array of findings. */
export function findingsOf(output: string): string[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || !parsed.every(isFinding)) {
    throw new Error(`the analyser printed no list of findings: ${output}`);
  }
  return parsed.map(
    finding => `${finding.file}:${String(finding.line)}: ${finding.message}`,
  );
}

if (isMainModule(import.meta.url)) {
  try {
    const analysis = spawnSync(
      'pwsh',
      analyzerArguments(
        path.join(REPOSITORY_ROOT, GOLDEN_POWERSHELL_FOLDER),
        pinnedAnalyzerVersion(
          readFileSync(
            path.join(REPOSITORY_ROOT, 'tools', 'install-pwsh'),
            'utf8',
          ),
        ),
      ),
      {encoding: 'utf8'},
    );
    if (analysis.error !== undefined || analysis.status !== 0) {
      throw new Error(
        `pwsh failed (${analysis.error?.message ?? analysis.stderr.trim()}); install it with tools/install-pwsh`,
      );
    }
    const findings = findingsOf(analysis.stdout);
    for (const finding of findings) {
      console.error(`check-powershell: ${finding}`);
    }
    if (findings.length === 0) {
      console.log('check-powershell: ok');
    }
    process.exitCode = findings.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`check-powershell: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
