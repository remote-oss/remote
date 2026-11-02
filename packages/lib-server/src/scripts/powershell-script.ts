/**
 * @fileoverview The PowerShell script of each bootstrap step built so far: the preamble, the parameter block, the
 * helper functions its roles name, and the step's body, which ends in the same result block as the POSIX script.
 */

import {CVE_LINE, NO_FREE_PORT_PREFIX, READY_LINE} from './posix-functions.ts';
import {POWERSHELL_FUNCTIONS, powershellQuote} from './powershell-functions.ts';
import {LAUNCHING_LINE} from './result-block.ts';
import {
  type BootstrapRequest,
  parameterValuesOf,
  rolesOf,
  type ScriptParameters,
  type StartParameters,
  startWordsOf,
} from './steps.ts';

/** Errors are handled by each step, and no progress bar is drawn into the output. */
const PREAMBLE: readonly string[] = [
  "$ErrorActionPreference = 'Continue'",
  "$ProgressPreference = 'SilentlyContinue'",
];

/** The installed-server test, for the folder named by `variable`. */
function launcherFact(fact: string, variable: string): string[] {
  return [
    `if (Test-Path -LiteralPath ([System.IO.Path]::Combine(${variable}, $LAUNCHER)) -PathType Leaf) {`,
    `  Add-Fact '${fact}' 'yes'`,
    '} else {',
    `  Add-Fact '${fact}' 'no'`,
    '}',
  ];
}

/**
 * What the host is: Windows from `OS`, the architecture from the 64-bit one when a 32-bit PowerShell runs, the tools
 * found as programs on the path, and whether the server is installed.
 */
const PROBE_BODY: readonly string[] = [
  "Add-Fact 'host.tmp' ([System.IO.Path]::GetTempPath().TrimEnd('\\', '/'))",
  "Add-Fact 'host.home' $HOME",
  "if ($env:OS -ne 'Windows_NT') {",
  "  Add-Fact 'host.os' ([string][System.Environment]::OSVersion.Platform)",
  "  Complete-Step 'UnsupportedPlatform'",
  '}',
  "Add-Fact 'host.os' 'win32'",
  '$Machine = $env:PROCESSOR_ARCHITEW6432',
  'if (-not $Machine) {',
  '  $Machine = $env:PROCESSOR_ARCHITECTURE',
  '}',
  'switch ($Machine) {',
  "  'AMD64' { $HostArch = 'x64' }",
  "  'ARM64' { $HostArch = 'arm64' }",
  '  default {',
  "    Add-Fact 'host.arch' ([string]$Machine)",
  "    Complete-Step 'UnsupportedArch'",
  '  }',
  '}',
  "Add-Fact 'host.arch' $HostArch",
  "Add-Fact 'host.libc' 'unknown'",
  "Add-Fact 'host.kernel' ([System.Environment]::OSVersion.Version.ToString())",
  "Add-Fact 'host.release' 'windows'",
  "foreach ($Tool in @('wget', 'curl', 'tar', 'unzip', 'flock', 'gzip')) {",
  "  if (Test-Program ($Tool + '.exe')) {",
  "    Add-Fact ('host.tool.' + $Tool) 'yes'",
  '  } else {',
  "    Add-Fact ('host.tool.' + $Tool) 'no'",
  '  }',
  '}',
  "Add-Fact 'host.wgetBusybox' 'no'",
  "Add-Fact 'host.shell' ''",
  "Add-Fact 'host.sshAuthSock' ([string]$env:SSH_AUTH_SOCK)",
  "Add-Fact 'host.display' ([string]$env:DISPLAY)",
  "Add-Fact 'server.installDir' $INSTALL_DIR",
  ...launcherFact('server.installed', '$INSTALL_DIR'),
];

function probeBody(installTree: string): readonly string[] {
  return [
    ...PROBE_BODY,
    ...(installTree === ''
      ? []
      : launcherFact('server.treeComplete', '$INSTALL_TREE')),
    "Complete-Step 'Ok'",
  ];
}

const LAUNCHER_PATH = '[System.IO.Path]::Combine($INSTALL_DIR, $LAUNCHER)';

/**
 * The install into the data folder: the folder and the lock, a server already there kept, the archive given or
 * downloaded, unpacked, and the launcher checked; the times of the download and the install are facts.
 */
const INSTALL_BODY: readonly string[] = [
  '$StartedAt = Get-NowSeconds',
  "if ($DATA_ROOT -eq '') {",
  "  Complete-Step 'CreateInstallDirFailed'",
  '}',
  'try {',
  '  New-Folder $INSTALL_DIR',
  '} catch {',
  '  Write-Failed $INSTALL_DIR (Get-FailureMessage $_)',
  '}',
  'Enter-LockOrComplete $COMMIT',
  `if (Test-Path -LiteralPath (${LAUNCHER_PATH}) -PathType Leaf) {`,
  "  Add-Fact 'server.installDir' $INSTALL_DIR",
  "  Exit-Step 'Ok'",
  '}',
  'Initialize-Environment',
  "if ($ARCHIVE_PATH -ne '') {",
  '  $Archive = $ARCHIVE_PATH',
  '} else {',
  "  $Archive = [System.IO.Path]::Combine($INSTALL_DIR, '.archive.' + $PID)",
  '  if ((Save-Archive $ARCHIVE_URL $Archive) -ne 0) {',
  '    Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue',
  "    Exit-Step 'ServerDownloadFailed'",
  '  }',
  '}',
  '$DownloadedAt = Get-NowSeconds',
  '$Unpacked = Expand-ServerArchive $Archive $INSTALL_DIR',
  "if ($ARCHIVE_PATH -eq '') {",
  '  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue',
  '}',
  `if (-not $Unpacked -or -not (Test-Path -LiteralPath (${LAUNCHER_PATH}) -PathType Leaf)) {`,
  "  Exit-Step 'UnpackFailed'",
  '}',
  "Add-Fact 'server.installDir' $INSTALL_DIR",
  "Add-Fact 'timing.download' ([string](($DownloadedAt - $StartedAt) * 1000))",
  "Add-Fact 'timing.install' ([string](Get-ElapsedMilliseconds $DownloadedAt))",
  "Exit-Step 'Ok'",
];

/** What an install into a server tree answers until the PowerShell script has the tree's functions. */
const INSTALL_TREE_BODY: readonly string[] = [
  "Add-Fact 'host.note' 'the Windows bootstrap script has no server tree install yet'",
  "Complete-Step 'ServerFailedToStart'",
];

/**
 * The server's start words as one Windows command line, each word double-quoted: Start-Process joins its arguments
 * with spaces and quotes nothing. A Windows host has no socket mode, so the server always listens on a port.
 */
function argumentLine(start: StartParameters): string {
  const words = startWordsOf({...start, socketMode: false}).map(word =>
    'text' in word
      ? powershellQuote(`"${word.text.replaceAll('"', '\\"')}"`)
      : `('"' + $${word.variable} + '"')`,
  );
  return `$SERVER_ARGUMENTS = @(${words.join(', ')}) -join ' '`;
}

/** The server's own lines as patterns: the ready line with its port, a port range with no free port, and the CVE stop. */
const SERVER_LINE_PATTERNS: readonly string[] = [
  `$ReadyPattern = '^' + [regex]::Escape(${powershellQuote(READY_LINE)}) + ' ([0-9]+)$'`,
  `$NoFreePortPattern = '^' + [regex]::Escape(${powershellQuote(NO_FREE_PORT_PREFIX)})`,
  `$CvePattern = ${powershellQuote(`^${CVE_LINE}$`)}`,
];

/**
 * The start: a server the PID file records and that still runs is reused, else the server is launched hidden with
 * its output in the log files, and its ready line is waited for; a launch that ends early, or a CVE stop, fails.
 */
function startBody(start: StartParameters): string[] {
  return [
    "$PID_FILE = $BOOT_PREFIX + '.pid'",
    "$LOG_FILE = $BOOT_PREFIX + '.log'",
    "$ERROR_LOG_FILE = $BOOT_PREFIX + '.err.log'",
    "$TOKEN_FILE = $BOOT_PREFIX + '.token'",
    '$StartedAt = Get-NowSeconds',
    ...SERVER_LINE_PATTERNS,
    'function Get-ReadyPort {',
    '  $Found = Select-String -LiteralPath $LOG_FILE -Pattern $ReadyPattern -ErrorAction SilentlyContinue | Select-Object -Last 1',
    '  if ($null -eq $Found) {',
    "    return ''",
    '  }',
    '  return $Found.Matches[0].Groups[1].Value',
    '}',
    'function Test-ServerLine([string]$Pattern) {',
    '  return $null -ne (Select-String -LiteralPath $LOG_FILE, $ERROR_LOG_FILE -Pattern $Pattern -ErrorAction SilentlyContinue | Select-Object -First 1)',
    '}',
    'function Stop-Starting {',
    '  if (Test-ServerLine $NoFreePortPattern) {',
    "    Add-Fact 'server.failure' 'noFreePort'",
    '  } elseif (Test-ServerLine $CvePattern) {',
    "    Add-Fact 'server.failure' 'cveTerminated'",
    '  }',
    "  Exit-Step 'ServerFailedToStart'",
    '}',
    'function Complete-Started([string]$Port, [int]$ServerId) {',
    '  $Token = Get-Content -LiteralPath $TOKEN_FILE -TotalCount 1 -ErrorAction SilentlyContinue',
    "  if (-not $Token -or $Port -notmatch '^[1-9][0-9]*$') {",
    '    Stop-Starting',
    '  }',
    "  Add-Fact 'server.port' $Port",
    "  Add-Fact 'server.pid' ([string]$ServerId)",
    "  Add-Fact 'server.token' $Token",
    "  Add-Fact 'server.log' $LOG_FILE",
    '  if ($Launched) {',
    "    Add-Fact 'server.reused' 'no'",
    '  } else {',
    "    Add-Fact 'server.reused' 'yes'",
    '  }',
    "  Add-Fact 'host.kernel' ([System.Environment]::OSVersion.Version.ToString())",
    "  Add-Fact 'timing.start' ([string](Get-ElapsedMilliseconds $StartedAt))",
    "  Exit-Step 'Ok'",
    '}',
    `if (-not (Test-Path -LiteralPath (${LAUNCHER_PATH}) -PathType Leaf)) {`,
    "  Complete-Step 'ServerFailedToStart'",
    '}',
    'Enter-LockOrComplete $COMMIT',
    '$ServerProcess = Get-RecordedServer $PID_FILE',
    // A running server whose token another principal may read is not reused: a new one starts with a new token.
    'if ($null -ne $ServerProcess -and -not (Test-ConnectionToken $TOKEN_FILE)) {',
    '  $ServerProcess = $null',
    '}',
    '$Launched = $false',
    'if ($null -eq $ServerProcess) {',
    '  Initialize-Environment',
    '  try {',
    '    if (-not (Test-ConnectionToken $TOKEN_FILE)) {',
    '      Write-ConnectionToken $TOKEN_FILE',
    '    }',
    '  } catch {',
    '    $Message = Get-FailureMessage $_',
    '    Exit-Lock',
    '    Write-Failed $TOKEN_FILE $Message',
    '  }',
    `  ${argumentLine(start)}`,
    `  Write-Line ${powershellQuote(LAUNCHING_LINE)}`,
    "  Add-Fact 'server.launching' 'yes'",
    `  $Launch = @{FilePath = (${LAUNCHER_PATH}); ArgumentList = $SERVER_ARGUMENTS; PassThru = $true; RedirectStandardOutput = $LOG_FILE; RedirectStandardError = $ERROR_LOG_FILE}`,
    '  try {',
    '    $ServerProcess = Start-Program $Launch',
    "    [System.IO.File]::WriteAllText($PID_FILE, [string]$ServerProcess.Id + ' ' + [string]$ServerProcess.StartTime.Ticks)",
    '  } catch {',
    '    $Message = Get-FailureMessage $_',
    '    if ($null -ne $ServerProcess) {',
    '      Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue',
    '    }',
    '    Exit-Lock',
    '    Write-Failed $PID_FILE $Message',
    '  }',
    '  $Launched = $true',
    '}',
    '$Ticks = [int]$READY_SECONDS * 5',
    'for ($Waited = 0; $Waited -lt $Ticks; $Waited++) {',
    '  $ReadPort = Get-ReadyPort',
    "  if ($ReadPort -ne '') {",
    '    Complete-Started $ReadPort $ServerProcess.Id',
    '  }',
    '  if ($ServerProcess.HasExited -and (-not $Launched -or (Test-ServerLine $CvePattern))) {',
    '    Stop-Starting',
    '  }',
    '  Start-Sleep -Milliseconds 200',
    '}',
    'Stop-Starting',
  ];
}

/** Installs each extension with the server's own command line, one fact pair per extension, in order. */
function installExtensionsBody(start: StartParameters): string[] {
  const extensions = start.extensions.map(powershellQuote).join(', ');
  return [
    `if (-not (Test-Path -LiteralPath (${LAUNCHER_PATH}) -PathType Leaf)) {`,
    "  Complete-Step 'ServerFailedToStart'",
    '}',
    'Initialize-Environment',
    "$ExtensionLog = $BOOT_PREFIX + '.extension.' + $PID",
    '$Position = 0',
    `foreach ($Extension in @(${extensions})) {`,
    `  & (${LAUNCHER_PATH}) --install-extension $Extension *> $ExtensionLog`,
    '  if ($LASTEXITCODE -eq 0) {',
    "    $ExtensionStatus = 'installed'",
    '  } else {',
    "    $ExtensionStatus = 'failed'",
    '  }',
    "  Add-Fact ('server.extension.' + $Position + '.status') $ExtensionStatus",
    '  $LastLine = [string](Get-Content -LiteralPath $ExtensionLog -Tail 1 -ErrorAction SilentlyContinue)',
    "  Add-Fact ('server.extension.' + $Position + '.message') $LastLine.Substring(0, [Math]::Min(300, $LastLine.Length))",
    '  $Position++',
    '}',
    'Remove-Item -LiteralPath $ExtensionLog -Force -ErrorAction SilentlyContinue',
    "Complete-Step 'Ok'",
  ];
}

function bodyOf(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): readonly string[] {
  switch (request.step) {
    case 'probe':
      return probeBody(parameters.installTree);
    case 'install':
      return parameters.installTree === '' ? INSTALL_BODY : INSTALL_TREE_BODY;
    case 'start':
      return parameters.installTree === ''
        ? startBody(parameters.start)
        : INSTALL_TREE_BODY;
    case 'installExtensions':
      return installExtensionsBody(parameters.start);
    default:
      return ["Complete-Step 'Ok'"];
  }
}

/** The steps the PowerShell script has; every other step still answers with a failure. */
export const POWERSHELL_STEPS: ReadonlySet<BootstrapRequest['step']> = new Set([
  'probe',
  'install',
  'discard',
  'start',
  'installExtensions',
]);

/**
 * The PowerShell script of one request in two parts: the head (the preamble, the parameters and the role functions)
 * and the step's body. A test can define stand-ins for the Windows-only functions between the two.
 */
export function powershellParts(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): {head: string; body: string} {
  if (!POWERSHELL_STEPS.has(request.step)) {
    throw new Error(`the PowerShell script has no ${request.step} step`);
  }
  return {
    head: [
      ...PREAMBLE,
      ...parameterValuesOf(parameters).map(
        ([name, value]) => `$${name} = ${powershellQuote(value)}`,
      ),
      ...rolesOf(request, parameters).flatMap(
        role => POWERSHELL_FUNCTIONS[role],
      ),
    ].join('\n'),
    body: [...bodyOf(request, parameters), ''].join('\n'),
  };
}

/**
 * The PowerShell script of one request: its head and its body. Throws for a step the script doesn't have yet, which
 * only a caller that skips `POWERSHELL_STEPS` can reach.
 */
export function powershellScript(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): string {
  const {head, body} = powershellParts(request, parameters);
  return `${head}\n${body}`;
}
