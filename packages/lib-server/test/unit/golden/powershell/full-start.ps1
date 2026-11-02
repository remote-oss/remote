$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$INSTALL_ROOT = '/opt/root dir'
$DATA_FOLDER = '.server-data'
$LAUNCHER = 'bin/launcher'
$COMMIT = 'abc123'
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
$CLI_NAME = 'codium-abc123'
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
function Initialize-Environment {
  if ($ENVIRONMENT_SETUP -ne '' -and (Test-Path -LiteralPath $ENVIRONMENT_SETUP -PathType Leaf)) {
    . $ENVIRONMENT_SETUP
  }
  if ($PROXY_HTTP -ne '' -and -not $env:http_proxy) {
    $env:http_proxy = $PROXY_HTTP
  }
  if ($PROXY_HTTPS -ne '' -and -not $env:https_proxy) {
    $env:https_proxy = $PROXY_HTTPS
  }
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
function Get-RecordedServer([string]$File) {
  try {
    $Fields = @((Get-Content -LiteralPath $File -TotalCount 1 -ErrorAction Stop) -split ' ')
    if ($Fields.Count -ne 2) {
      return $null
    }
    $Found = Get-Process -Id ([int]$Fields[0]) -ErrorAction Stop
    if ($Found.HasExited -or [Math]::Abs($Found.StartTime.Ticks - [long]$Fields[1]) -gt 10000000) {
      return $null
    }
    return $Found
  } catch {
    return $null
  }
}
function Exit-Step([string]$Status) {
  Exit-Lock
  Complete-Step $Status
}
Add-Fact 'host.note' 'the Windows bootstrap script has no server tree install yet'
Complete-Step 'ServerFailedToStart'
