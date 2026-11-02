$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$INSTALL_ROOT = ''
$DATA_FOLDER = '.server-data'
$LAUNCHER = 'bin/launcher'
$COMMIT = 'abc123'
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
$PID_FILE = $BOOT_PREFIX + '.pid'
$LOG_FILE = $BOOT_PREFIX + '.log'
$ERROR_LOG_FILE = $BOOT_PREFIX + '.err.log'
$TOKEN_FILE = $BOOT_PREFIX + '.token'
$StartedAt = Get-NowSeconds
$ReadyPattern = '^' + [regex]::Escape('Extension host agent listening on') + ' ([0-9]+)$'
$NoFreePortPattern = '^' + [regex]::Escape('--port: Could not find free port in range: ')
$CvePattern = '^\* !!!! Server terminated due to presence of CVE-2020-1416 !!!!$'
function Get-ReadyPort {
  $Found = Select-String -LiteralPath $LOG_FILE -Pattern $ReadyPattern -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($null -eq $Found) {
    return ''
  }
  return $Found.Matches[0].Groups[1].Value
}
function Test-ServerLine([string]$Pattern) {
  return $null -ne (Select-String -LiteralPath $LOG_FILE, $ERROR_LOG_FILE -Pattern $Pattern -ErrorAction SilentlyContinue | Select-Object -First 1)
}
function Stop-Starting {
  if (Test-ServerLine $NoFreePortPattern) {
    Add-Fact 'server.failure' 'noFreePort'
  } elseif (Test-ServerLine $CvePattern) {
    Add-Fact 'server.failure' 'cveTerminated'
  }
  Exit-Step 'ServerFailedToStart'
}
function Complete-Started([string]$Port, [int]$ServerId) {
  $Token = Get-Content -LiteralPath $TOKEN_FILE -TotalCount 1 -ErrorAction SilentlyContinue
  if (-not $Token -or $Port -notmatch '^[1-9][0-9]*$') {
    Stop-Starting
  }
  Add-Fact 'server.port' $Port
  Add-Fact 'server.pid' ([string]$ServerId)
  Add-Fact 'server.token' $Token
  Add-Fact 'server.log' $LOG_FILE
  if ($Launched) {
    Add-Fact 'server.reused' 'no'
  } else {
    Add-Fact 'server.reused' 'yes'
  }
  Add-Fact 'host.kernel' ([System.Environment]::OSVersion.Version.ToString())
  Add-Fact 'timing.start' ([string](Get-ElapsedMilliseconds $StartedAt))
  Exit-Step 'Ok'
}
if (-not (Test-Path -LiteralPath ([System.IO.Path]::Combine($INSTALL_DIR, $LAUNCHER)) -PathType Leaf)) {
  Complete-Step 'ServerFailedToStart'
}
Enter-LockOrComplete $COMMIT
$ServerProcess = Get-RecordedServer $PID_FILE
$Launched = $false
if ($null -eq $ServerProcess) {
  Initialize-Environment
  try {
    if (-not (Test-Path -LiteralPath $TOKEN_FILE -PathType Leaf) -or (Get-Item -LiteralPath $TOKEN_FILE).Length -eq 0) {
      $Characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      $Bytes = New-Object byte[] 32
      $Generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      $Generator.GetBytes($Bytes)
      $Generator.Dispose()
      [System.IO.File]::WriteAllText($TOKEN_FILE, -join ($Bytes | ForEach-Object { $Characters[$_ % 62] }))
    }
  } catch {
    $Message = Get-FailureMessage $_
    Exit-Lock
    Write-Failed $TOKEN_FILE $Message
  }
  $SERVER_ARGUMENTS = @('"--start-server"', '"--host"', '"127.0.0.1"', '"--port"', '"0"', '"--connection-token-file"', ('"' + $TOKEN_FILE + '"'), '"--telemetry-level"', '"off"', '"--enable-remote-auto-shutdown"') -join ' '
  Write-Line 'server.launching=yes'
  Add-Fact 'server.launching' 'yes'
  $Launch = @{FilePath = ([System.IO.Path]::Combine($INSTALL_DIR, $LAUNCHER)); ArgumentList = $SERVER_ARGUMENTS; PassThru = $true; RedirectStandardOutput = $LOG_FILE; RedirectStandardError = $ERROR_LOG_FILE}
  if ([System.Environment]::OSVersion.Platform -eq 'Win32NT') {
    $Launch.WindowStyle = 'Hidden'
  }
  try {
    $ServerProcess = Start-Process @Launch
    [System.IO.File]::WriteAllText($PID_FILE, [string]$ServerProcess.Id + ' ' + [string]$ServerProcess.StartTime.Ticks)
  } catch {
    $Message = Get-FailureMessage $_
    if ($null -ne $ServerProcess) {
      Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Exit-Lock
    Write-Failed $PID_FILE $Message
  }
  $Launched = $true
}
$Ticks = [int]$READY_SECONDS * 5
for ($Waited = 0; $Waited -lt $Ticks; $Waited++) {
  $ReadPort = Get-ReadyPort
  if ($ReadPort -ne '') {
    Complete-Started $ReadPort $ServerProcess.Id
  }
  if ($ServerProcess.HasExited -and (-not $Launched -or (Test-ServerLine $CvePattern))) {
    Stop-Starting
  }
  Start-Sleep -Milliseconds 200
}
Stop-Starting
