/**
 * @fileoverview The helper functions of the PowerShell bootstrap script, by role. The script targets Windows PowerShell
 * 5.1, the shell OpenSSH for Windows starts, so it uses no syntax newer than 5.1. Every line it prints ends in a bare
 * line feed, so the result block reads the same as the POSIX script's.
 */

import {RESULT_BEGIN, RESULT_END} from './result-block.ts';
import type {FunctionRole} from './steps.ts';

/** Quote a value for PowerShell as one single-quoted string, whatever it holds. */
export function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The functions every step uses: the result block, facts, programs, times and the data folder's places. */
const COMMON_FUNCTIONS: readonly string[] = [
  "$ResultFacts = New-Object -TypeName 'System.Collections.Generic.List[string]'",
  'function Write-Line([string]$Text) {',
  '  [Console]::Out.Write($Text + "`n")',
  '}',
  'function Add-Fact([string]$Name, [string]$Value) {',
  "  $ResultFacts.Add($Name + '=' + ($Value -replace \"[`r`n]\", ' '))",
  '}',
  'function Write-Result([string]$Status) {',
  "  Write-Line ''",
  `  Write-Line ${powershellQuote(RESULT_BEGIN)}`,
  "  Write-Line ('status=' + $Status)",
  '  foreach ($Line in $ResultFacts) {',
  '    Write-Line $Line',
  '  }',
  `  Write-Line ${powershellQuote(RESULT_END)}`,
  '}',
  'function Complete-Step([string]$Status) {',
  "  if ($ARCHIVE_REMOVE -eq 'yes' -and $ARCHIVE_PATH -ne '' -and $Status -ne 'LockBusy') {",
  '    Remove-Item -LiteralPath $ARCHIVE_PATH -Force -ErrorAction SilentlyContinue',
  '  }',
  '  Write-Result $Status',
  '  exit 0',
  '}',
  'function Test-Program([string]$Name) {',
  '  return $null -ne (Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue)',
  '}',
  'function Get-NowSeconds {',
  '  return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()',
  '}',
  'function Get-ElapsedMilliseconds([long]$Since) {',
  '  return ((Get-NowSeconds) - $Since) * 1000',
  '}',
  "if ($INSTALL_ROOT -eq '~') {",
  '  $INSTALL_ROOT = $HOME',
  "} elseif ($INSTALL_ROOT.StartsWith('~/') -or $INSTALL_ROOT.StartsWith('~\\')) {",
  '  $INSTALL_ROOT = [System.IO.Path]::Combine($HOME, $INSTALL_ROOT.Substring(2))',
  '}',
  "if ($INSTALL_ROOT -ne '') {",
  '  $DATA_ROOT = $INSTALL_ROOT',
  '} else {',
  '  $DATA_ROOT = $HOME',
  '}',
  '$DATA_DIR = [System.IO.Path]::Combine($DATA_ROOT, $DATA_FOLDER)',
  "$INSTALL_DIR = [System.IO.Path]::Combine($DATA_DIR, 'bin', $COMMIT)",
  "$CLI_STAGING = [System.IO.Path]::Combine($DATA_DIR, 'cli-bin', $COMMIT)",
  '$CLI_FILE = [System.IO.Path]::Combine($DATA_DIR, $CLI_NAME)',
  "$BOOT_PREFIX = [System.IO.Path]::Combine($DATA_DIR, '.' + $COMMIT)",
  "if ($INSTALL_TREE -ne '') {",
  "  $LOCK_IN_TEMPORARY = 'yes'",
  '}',
];

/**
 * The text of each function role in the PowerShell script. BusyBox doesn't exist on Windows, so its role is empty; the
 * other empty roles are filled as their steps are built.
 */
export const POWERSHELL_FUNCTIONS: Readonly<
  Record<FunctionRole, readonly string[]>
> = {
  common: COMMON_FUNCTIONS,
  environment: [],
  lock: [],
  busybox: [],
  fetch: [],
  unpack: [],
  leave: [],
  process: [],
  serverTree: [],
  stop: [],
  cliPort: [],
  folderKind: [],
  tree: [],
};
