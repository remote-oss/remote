$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$INSTALL_ROOT = ''
$DATA_FOLDER = '.server-data'
$LAUNCHER = 'bin/launcher'
$COMMIT = 'abc1230000000000000000000000000000000000'
$ARCHIVE_URL = 'https://example.invalid/server.tar.gz'
$ARCHIVE_PATH = ''
$ARCHIVE_REMOVE = 'no'
$ARCHIVE_FORMAT = 'tar.gz'
$STAGING_SUFFIX = '1700000000000'
$INSTALL_TREE = ''
$PROXY_HTTP = ''
$PROXY_HTTPS = ''
$USE_CONFIGURATION_FILES = 'no'
$DOWNLOAD_SECONDS = '30'
$LOCK_METHOD = 'link'
$LOCK_IN_TEMPORARY = 'no'
$LOCK_PREFIX = 'boot-lock.user'
$ENVIRONMENT_SETUP = ''
$INSTALL_UMASK = 'inherit'
$CLEANUP_KIND = 'keepNewest'
$KEEP_COUNT = '5'
$BIND_HOST = '127.0.0.1'
$SERVER_PORT = '0'
$REQUIREMENTS_HELPER = 'no'
$READY_SECONDS = '3'
$SOCKET_MODE = 'no'
$CLI_NAME = ''
$CLI_DATA = ''
$CLI_STOP_PID = ''
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
Complete-Step 'Ok'
