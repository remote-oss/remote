$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$INSTALL_ROOT = '/opt/root dir'
$DATA_FOLDER = '.server-data'
$LAUNCHER = 'bin/launcher'
$COMMIT = 'abc1230000000000000000000000000000000000'
$ARCHIVE_URL = 'https://example.invalid/server.tar.gz'
$ARCHIVE_PATH = '/tmp/a b.tar.gz'
$ARCHIVE_REMOVE = 'yes'
$ARCHIVE_FORMAT = 'tar.gz'
$STAGING_SUFFIX = '1700000000000'
$INSTALL_TREE = '/srv/tree'
$PROXY_HTTP = 'http://proxy:3128'
$PROXY_HTTPS = 'http://it''s:3129'
$USE_CONFIGURATION_FILES = 'yes'
$DOWNLOAD_SECONDS = '45'
$LOCK_METHOD = 'flock'
$LOCK_IN_TEMPORARY = 'yes'
$LOCK_PREFIX = 'lock.u'
$ENVIRONMENT_SETUP = '/etc/profile.d/x.sh'
$INSTALL_UMASK = '022'
$CLEANUP_KIND = 'keepNewest'
$KEEP_COUNT = '2'
$BIND_HOST = '127.0.0.1'
$SERVER_PORT = '8000-9000'
$REQUIREMENTS_HELPER = 'yes'
$READY_SECONDS = '3'
$SOCKET_MODE = 'yes'
$CLI_NAME = 'codium-abc1230000000000000000000000000000000000'
$CLI_DATA = '/home/u/.cli'
$CLI_STOP_PID = '4242'
$ResultFacts = New-Object -TypeName 'System.Collections.Generic.List[string]'
function Write-Line([string]$Text) {
  [Console]::Out.Write($Text + "`n")
}
function Add-Fact([string]$Name, [string]$Value) {
  $ResultFacts.Add($Name + '=' + ($Value -replace "[`r`n]", ' '))
}
function Write-Result([string]$Status) {
  Write-Line ''
  Write-Line 'remote-oss-server-result-begin'
  Write-Line ('status=' + $Status)
  foreach ($Line in $ResultFacts) {
    Write-Line $Line
  }
  Write-Line 'remote-oss-server-result-end'
}
function Complete-Step([string]$Status) {
  if ($ARCHIVE_REMOVE -eq 'yes' -and $ARCHIVE_PATH -ne '' -and $Status -ne 'LockBusy') {
    Remove-Item -LiteralPath $ARCHIVE_PATH -Force -ErrorAction SilentlyContinue
  }
  Write-Result $Status
  exit 0
}
function Test-Program([string]$Name) {
  return $null -ne (Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue)
}
function New-Folder([string]$Path) {
  [void][System.IO.Directory]::CreateDirectory($Path)
}
function Get-FailureMessage($Failure) {
  $Exception = $Failure.Exception
  if ($null -ne $Exception.InnerException) {
    $Exception = $Exception.InnerException
  }
  return $Exception.Message
}
function New-Secret {
  $Characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $Bytes = New-Object byte[] 32
  $Generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $Generator.GetBytes($Bytes)
  $Generator.Dispose()
  return -join ($Bytes | ForEach-Object { $Characters[$_ % 62] })
}
function Start-Program([hashtable]$Launch) {
  if ([System.Environment]::OSVersion.Platform -eq 'Win32NT') {
    $Launch.WindowStyle = 'Hidden'
  }
  return Start-Process @Launch
}
function ConvertTo-WindowsArgument([string]$Value) {
  return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
function Get-NowSeconds {
  return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
}
function Get-ElapsedMilliseconds([long]$Since) {
  return ((Get-NowSeconds) - $Since) * 1000
}
if ($INSTALL_ROOT -eq '~') {
  $INSTALL_ROOT = $HOME
} elseif ($INSTALL_ROOT.StartsWith('~/') -or $INSTALL_ROOT.StartsWith('~\')) {
  $INSTALL_ROOT = [System.IO.Path]::Combine($HOME, $INSTALL_ROOT.Substring(2))
}
if ($INSTALL_ROOT -ne '') {
  $DATA_ROOT = $INSTALL_ROOT
} else {
  $DATA_ROOT = $HOME
}
$DATA_DIR = [System.IO.Path]::Combine($DATA_ROOT, $DATA_FOLDER)
$INSTALL_DIR = [System.IO.Path]::Combine($DATA_DIR, 'bin', $COMMIT)
$CLI_STAGING = [System.IO.Path]::Combine($DATA_DIR, 'cli-bin', $COMMIT)
$CLI_FILE = [System.IO.Path]::Combine($DATA_DIR, $CLI_NAME)
$BOOT_PREFIX = [System.IO.Path]::Combine($DATA_DIR, '.' + $COMMIT)
if ($INSTALL_TREE -ne '') {
  $LOCK_IN_TEMPORARY = 'yes'
}
Add-Fact 'host.tmp' ([System.IO.Path]::GetTempPath().TrimEnd('\', '/'))
Add-Fact 'host.home' $HOME
if ($env:OS -ne 'Windows_NT') {
  Add-Fact 'host.os' ([string][System.Environment]::OSVersion.Platform)
  Complete-Step 'UnsupportedPlatform'
}
Add-Fact 'host.os' 'win32'
$Machine = $env:PROCESSOR_ARCHITEW6432
if (-not $Machine) {
  $Machine = $env:PROCESSOR_ARCHITECTURE
}
switch ($Machine) {
  'AMD64' { $HostArch = 'x64' }
  'ARM64' { $HostArch = 'arm64' }
  default {
    Add-Fact 'host.arch' ([string]$Machine)
    Complete-Step 'UnsupportedArch'
  }
}
Add-Fact 'host.arch' $HostArch
Add-Fact 'host.libc' 'unknown'
Add-Fact 'host.kernel' ([System.Environment]::OSVersion.Version.ToString())
Add-Fact 'host.release' 'windows'
foreach ($Tool in @('wget', 'curl', 'tar', 'unzip', 'flock', 'gzip')) {
  if (Test-Program ($Tool + '.exe')) {
    Add-Fact ('host.tool.' + $Tool) 'yes'
  } else {
    Add-Fact ('host.tool.' + $Tool) 'no'
  }
}
Add-Fact 'host.wgetBusybox' 'no'
Add-Fact 'host.shell' ''
Add-Fact 'host.sshAuthSock' ([string]$env:SSH_AUTH_SOCK)
Add-Fact 'host.display' ([string]$env:DISPLAY)
Add-Fact 'server.installDir' $INSTALL_DIR
if (Test-Path -LiteralPath ([System.IO.Path]::Combine($INSTALL_DIR, $LAUNCHER)) -PathType Leaf) {
  Add-Fact 'server.installed' 'yes'
} else {
  Add-Fact 'server.installed' 'no'
}
if (Test-Path -LiteralPath ([System.IO.Path]::Combine($INSTALL_TREE, $LAUNCHER)) -PathType Leaf) {
  Add-Fact 'server.treeComplete' 'yes'
} else {
  Add-Fact 'server.treeComplete' 'no'
}
Complete-Step 'Ok'
