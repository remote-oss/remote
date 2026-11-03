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
$LockStream = $null
$LockCandidate = ''
$LockError = ''
function Get-LockPath([string]$Commit) {
  if ($LOCK_IN_TEMPORARY -eq 'yes') {
    return [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), $LOCK_PREFIX + '.' + $Commit)
  }
  return [System.IO.Path]::Combine($DATA_DIR, 'bin', $Commit, $LOCK_PREFIX + '.' + $Commit)
}
function Enter-Lock([string]$Commit) {
  $script:LockCandidate = Get-LockPath $Commit
  $script:LockError = ''
  try {
    $script:LockStream = [System.IO.File]::Open($script:LockCandidate, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch [System.IO.IOException] {
    if ($_.Exception.GetType() -eq [System.IO.IOException]) {
      return 1
    }
    $script:LockError = Get-FailureMessage $_
    return 2
  } catch {
    $script:LockError = Get-FailureMessage $_
    return 2
  }
  return 0
}
function Exit-Lock {
  if ($null -ne $script:LockStream) {
    $script:LockStream.Dispose()
    $script:LockStream = $null
    Remove-Item -LiteralPath $script:LockCandidate -Force -ErrorAction SilentlyContinue
  }
}
function Write-Failed([string]$Path, [string]$Message) {
  Add-Fact 'server.writeFailedPath' $Path
  Add-Fact 'server.writeFailedError' $Message
  Complete-Step 'CreateInstallDirFailed'
}
function Enter-LockOrComplete([string]$Commit) {
  $Taken = Enter-Lock $Commit
  if ($Taken -eq 1) {
    Add-Fact 'server.lockPath' $script:LockCandidate
    Complete-Step 'LockBusy'
  }
  if ($Taken -eq 2) {
    Add-Fact 'server.lockPath' $script:LockCandidate
    Add-Fact 'server.lockInTemporary' $LOCK_IN_TEMPORARY
    Write-Failed $script:LockCandidate $script:LockError
  }
}
function Get-FolderKind([string]$Name) {
  if ($Name -cmatch '^[0-9a-f]{40}$') {
    return 'commit'
  }
  if ($Name -cmatch '^[0-9a-f]{40}-') {
    return 'leftover'
  }
  return 'other'
}
function Remove-Install([string]$Name) {
  if ((Enter-Lock $Name) -ne 0) {
    return
  }
  Remove-Item -LiteralPath ([System.IO.Path]::Combine($DATA_DIR, 'bin', $Name)) -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($Suffix in @('log', 'pid', 'token', 'err.log', 'socket.log', 'socket.pid', 'socket.token')) {
    Remove-Item -LiteralPath ([System.IO.Path]::Combine($DATA_DIR, '.' + $Name + '.' + $Suffix)) -Force -ErrorAction SilentlyContinue
  }
  Exit-Lock
}
if ($DATA_ROOT -eq '' -or $DATA_FOLDER -eq '') {
  Complete-Step 'Ok'
}
$BinFolder = [System.IO.Path]::Combine($DATA_DIR, 'bin')
if (-not (Test-Path -LiteralPath $BinFolder -PathType Container)) {
  Complete-Step 'Ok'
}
$Index = 0
foreach ($Folder in @(Get-ChildItem -LiteralPath $BinFolder -Force | Sort-Object -Property LastWriteTime -Descending)) {
  $Index++
  $Name = $Folder.Name
  if ($Name -eq $COMMIT) {
    continue
  }
  $Kind = Get-FolderKind $Name
  switch ($CLEANUP_KIND) {
    'keepNewest' {
      if ($Index -gt [int]$KEEP_COUNT) {
        Remove-Install $Name
      }
    }
    'onlyCurrentRemoveLeftovers' {
      if ($Kind -ne 'other') {
        Remove-Install $Name
      }
    }
    default {
      if ($Kind -eq 'commit') {
        Remove-Install $Name
      }
    }
  }
}
Complete-Step 'Ok'
