/**
 * @fileoverview The PowerShell script of each bootstrap step built so far: the preamble, the parameter block, the
 * helper functions its roles name, and the step's body, which ends in the same result block as the POSIX script.
 */

import {POWERSHELL_FUNCTIONS, powershellQuote} from './powershell-functions.ts';
import {
  type BootstrapRequest,
  parameterValuesOf,
  rolesOf,
  type ScriptParameters,
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

function bodyOf(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): readonly string[] {
  switch (request.step) {
    case 'probe':
      return probeBody(parameters.installTree);
    case 'install':
      return parameters.installTree === '' ? INSTALL_BODY : INSTALL_TREE_BODY;
    default:
      return ["Complete-Step 'Ok'"];
  }
}

/** The steps the PowerShell script has; every other step still answers with a failure. */
export const POWERSHELL_STEPS: ReadonlySet<BootstrapRequest['step']> = new Set([
  'probe',
  'install',
  'discard',
]);

/**
 * The PowerShell script of one request: the preamble, the parameters, the role functions and the step's body. Throws
 * for a step the script doesn't have yet, which only a caller that skips `POWERSHELL_STEPS` can reach.
 */
export function powershellScript(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): string {
  if (!POWERSHELL_STEPS.has(request.step)) {
    throw new Error(`the PowerShell script has no ${request.step} step`);
  }
  return [
    ...PREAMBLE,
    ...parameterValuesOf(parameters).map(
      ([name, value]) => `$${name} = ${powershellQuote(value)}`,
    ),
    ...rolesOf(request, parameters).flatMap(role => POWERSHELL_FUNCTIONS[role]),
    ...bodyOf(request, parameters),
    '',
  ].join('\n');
}
