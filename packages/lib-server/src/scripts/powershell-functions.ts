/**
 * @fileoverview The helper functions of the PowerShell bootstrap script, by role. The script targets Windows PowerShell
 * 5.1, the shell OpenSSH for Windows starts, so it uses no syntax newer than 5.1. Every line it prints ends in a bare
 * line feed, so the result block reads the same as the POSIX script's.
 */

import {PROGRESS_PREFIX} from './progress-line.ts';
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
  'function New-Folder([string]$Path) {',
  '  [void][System.IO.Directory]::CreateDirectory($Path)',
  '}',
  'function Get-FailureMessage($Failure) {',
  '  $Exception = $Failure.Exception',
  '  if ($null -ne $Exception.InnerException) {',
  '    $Exception = $Exception.InnerException',
  '  }',
  '  return $Exception.Message',
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

/** The environment setup, dot-sourced when it exists, and the proxy variables the host's own environment does not set. */
const ENVIRONMENT_FUNCTIONS: readonly string[] = [
  'function Initialize-Environment {',
  "  if ($ENVIRONMENT_SETUP -ne '' -and (Test-Path -LiteralPath $ENVIRONMENT_SETUP -PathType Leaf)) {",
  '    . $ENVIRONMENT_SETUP',
  '  }',
  "  if ($PROXY_HTTP -ne '' -and -not $env:http_proxy) {",
  '    $env:http_proxy = $PROXY_HTTP',
  '  }',
  "  if ($PROXY_HTTPS -ne '' -and -not $env:https_proxy) {",
  '    $env:https_proxy = $PROXY_HTTPS',
  '  }',
  '}',
];

/**
 * The install lock: the lock file opened with no sharing, held until the script releases it or ends. A second opener
 * fails with a plain IOException (busy); any other failure, its subclasses included, is a write failure, reported
 * with its message.
 */
const LOCK_FUNCTIONS: readonly string[] = [
  '$LockStream = $null',
  "$LockCandidate = ''",
  "$LockError = ''",
  'function Get-LockPath([string]$Commit) {',
  "  if ($LOCK_IN_TEMPORARY -eq 'yes') {",
  "    return [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), $LOCK_PREFIX + '.' + $Commit)",
  '  }',
  "  return [System.IO.Path]::Combine($DATA_DIR, 'bin', $Commit, $LOCK_PREFIX + '.' + $Commit)",
  '}',
  'function Enter-Lock([string]$Commit) {',
  '  $script:LockCandidate = Get-LockPath $Commit',
  "  $script:LockError = ''",
  '  try {',
  '    $script:LockStream = [System.IO.File]::Open($script:LockCandidate, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)',
  '  } catch [System.IO.IOException] {',
  '    if ($_.Exception.GetType() -eq [System.IO.IOException]) {',
  '      return 1',
  '    }',
  '    $script:LockError = Get-FailureMessage $_',
  '    return 2',
  '  } catch {',
  '    $script:LockError = Get-FailureMessage $_',
  '    return 2',
  '  }',
  '  return 0',
  '}',
  'function Exit-Lock {',
  '  if ($null -ne $script:LockStream) {',
  '    $script:LockStream.Dispose()',
  '    $script:LockStream = $null',
  '    Remove-Item -LiteralPath $script:LockCandidate -Force -ErrorAction SilentlyContinue',
  '  }',
  '}',
  'function Write-Failed([string]$Path, [string]$Message) {',
  "  Add-Fact 'server.writeFailedPath' $Path",
  "  Add-Fact 'server.writeFailedError' $Message",
  "  Complete-Step 'CreateInstallDirFailed'",
  '}',
  'function Enter-LockOrComplete([string]$Commit) {',
  '  $Taken = Enter-Lock $Commit',
  '  if ($Taken -eq 1) {',
  "    Add-Fact 'server.lockPath' $script:LockCandidate",
  "    Complete-Step 'LockBusy'",
  '  }',
  '  if ($Taken -eq 2) {',
  "    Add-Fact 'server.lockPath' $script:LockCandidate",
  "    Add-Fact 'server.lockInTemporary' $LOCK_IN_TEMPORARY",
  '    Write-Failed $script:LockCandidate $script:LockError',
  '  }',
  '}',
];

/** Downloads the archive, through the proxy the environment names; a 404 is reported as a fact. Returns 0 when it worked. */
const FETCH_FUNCTIONS: readonly string[] = [
  'function Save-Archive([string]$Address, [string]$Archive) {',
  '  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12',
  "  $Request = @{Uri = $Address; OutFile = $Archive; UseBasicParsing = $true; TimeoutSec = [int]$DOWNLOAD_SECONDS; ErrorAction = 'Stop'}",
  "  if ($Address.StartsWith('https:') -and $env:https_proxy) {",
  '    $Request.Proxy = $env:https_proxy',
  "  } elseif ($Address.StartsWith('http:') -and $env:http_proxy) {",
  '    $Request.Proxy = $env:http_proxy',
  '  }',
  '  try {',
  '    Invoke-WebRequest @Request',
  '    return 0',
  '  } catch {',
  '    $Response = $_.Exception.Response',
  '    if ($null -ne $Response -and [int]$Response.StatusCode -eq 404) {',
  "      Add-Fact 'server.downloadStatus' '404'",
  '    }',
  '    return 1',
  '  }',
  '}',
];

/**
 * Unpacks the archive into a stage beside the target, a zip with .NET's own reader and a tar file with `tar.exe`, and
 * moves its content into the target, lifting a single top folder. Returns whether anything was moved.
 */
const UNPACK_FUNCTIONS: readonly string[] = [
  'function Write-StepProgress([string]$Phase, [int]$Percent) {',
  `  Write-Line ('${PROGRESS_PREFIX} ' + $Phase + ' ' + $Percent)`,
  '}',
  'function Move-ArchiveTop([string]$Stage, [string]$Target) {',
  '  $Entries = @(Get-ChildItem -LiteralPath $Stage -Force)',
  '  $Source = $Stage',
  '  if ($Entries.Count -eq 1 -and $Entries[0].PSIsContainer -and -not ($Entries[0].Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {',
  '    $Source = $Entries[0].FullName',
  '  }',
  '  $Moved = $false',
  '  foreach ($Entry in @(Get-ChildItem -LiteralPath $Source -Force)) {',
  '    try {',
  '      Move-Item -LiteralPath $Entry.FullName -Destination $Target -Force -ErrorAction Stop',
  '    } catch {',
  '      return $false',
  '    }',
  '    $Moved = $true',
  '  }',
  '  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue',
  '  return $Moved',
  '}',
  'function Expand-ServerArchive([string]$Archive, [string]$Target) {',
  "  $Stage = $Target + '.stage.' + $PID",
  '  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue',
  '  try {',
  '    New-Folder $Stage',
  '    New-Folder $Target',
  "    Write-StepProgress 'unpack' 0",
  "    if ($ARCHIVE_FORMAT -eq 'zip') {",
  '      Add-Type -AssemblyName System.IO.Compression.FileSystem',
  '      [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Stage)',
  '    } else {',
  '      & tar.exe -xzf $Archive -C $Stage',
  '      if ($LASTEXITCODE -ne 0) {',
  '        return $false',
  '      }',
  '    }',
  '  } catch {',
  '    return $false',
  '  }',
  "  Write-StepProgress 'unpack' 100",
  '  return (Move-ArchiveTop $Stage $Target)',
  '}',
];

/** Ends the script with a status after releasing the lock it holds. */
const LEAVE_FUNCTIONS: readonly string[] = [
  'function Exit-Step([string]$Status) {',
  '  Exit-Lock',
  '  Complete-Step $Status',
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
  environment: ENVIRONMENT_FUNCTIONS,
  lock: LOCK_FUNCTIONS,
  busybox: [],
  fetch: FETCH_FUNCTIONS,
  unpack: UNPACK_FUNCTIONS,
  leave: LEAVE_FUNCTIONS,
  process: [],
  serverTree: [],
  stop: [],
  cliPort: [],
  folderKind: [],
  tree: [],
};
