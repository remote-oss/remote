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
function Save-Archive([string]$Address, [string]$Archive) {
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
  $Request = @{Uri = $Address; OutFile = $Archive; UseBasicParsing = $true; TimeoutSec = [int]$DOWNLOAD_SECONDS; ErrorAction = 'Stop'}
  if ($Address.StartsWith('https:') -and $env:https_proxy) {
    $Request.Proxy = $env:https_proxy
  } elseif ($Address.StartsWith('http:') -and $env:http_proxy) {
    $Request.Proxy = $env:http_proxy
  }
  try {
    Invoke-WebRequest @Request
    return 0
  } catch {
    $Response = $_.Exception.Response
    if ($null -ne $Response -and [int]$Response.StatusCode -eq 404) {
      Add-Fact 'server.downloadStatus' '404'
    }
    return 1
  }
}
function Write-StepProgress([string]$Phase, [int]$Percent) {
  Write-Line ('remote-oss-server-progress ' + $Phase + ' ' + $Percent)
}
function Move-ArchiveTop([string]$Stage, [string]$Target) {
  $Entries = @(Get-ChildItem -LiteralPath $Stage -Force)
  $Source = $Stage
  if ($Entries.Count -eq 1 -and $Entries[0].PSIsContainer -and -not ($Entries[0].Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    $Source = $Entries[0].FullName
  }
  $Moved = $false
  foreach ($Entry in @(Get-ChildItem -LiteralPath $Source -Force)) {
    try {
      Move-Item -LiteralPath $Entry.FullName -Destination $Target -Force -ErrorAction Stop
    } catch {
      return $false
    }
    $Moved = $true
  }
  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
  return $Moved
}
function Expand-ServerArchive([string]$Archive, [string]$Target) {
  $Stage = $Target + '.stage.' + $PID
  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
  try {
    New-Folder $Stage
    New-Folder $Target
    Write-StepProgress 'unpack' 0
    if ($ARCHIVE_FORMAT -eq 'zip') {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Stage)
    } else {
      & tar.exe -xzf $Archive -C $Stage
      if ($LASTEXITCODE -ne 0) {
        return $false
      }
    }
  } catch {
    return $false
  }
  Write-StepProgress 'unpack' 100
  return (Move-ArchiveTop $Stage $Target)
}
function Exit-Step([string]$Status) {
  Exit-Lock
  Complete-Step $Status
}
function Clear-Staging {
  Remove-Item -LiteralPath $CLI_STAGING -Recurse -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path ($CLI_STAGING + '.stage.*') -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  $CliBin = [System.IO.Path]::Combine($DATA_DIR, 'cli-bin')
  if (@(Get-ChildItem -LiteralPath $CliBin -Force -ErrorAction SilentlyContinue).Count -eq 0) {
    Remove-Item -LiteralPath $CliBin -Force -ErrorAction SilentlyContinue
  }
}
$StartedAt = Get-NowSeconds
if ($DATA_ROOT -eq '' -or $CLI_NAME -eq '') {
  Complete-Step 'CreateInstallDirFailed'
}
try {
  New-Folder $INSTALL_DIR
} catch {
  Write-Failed $INSTALL_DIR (Get-FailureMessage $_)
}
Enter-LockOrComplete $COMMIT
if (Test-Path -LiteralPath $CLI_FILE -PathType Leaf) {
  Add-Fact 'cli.path' $CLI_FILE
  Exit-Step 'Ok'
}
try {
  New-Folder $CLI_STAGING
} catch {
  $Message = Get-FailureMessage $_
  Exit-Lock
  Write-Failed $CLI_STAGING $Message
}
Initialize-Environment
if ($ARCHIVE_PATH -ne '') {
  $Archive = $ARCHIVE_PATH
} else {
  $Archive = $CLI_STAGING + '.archive.' + $PID
  if ((Save-Archive $ARCHIVE_URL $Archive) -ne 0) {
    Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
    Clear-Staging
    Exit-Step 'ServerDownloadFailed'
  }
}
$DownloadedAt = Get-NowSeconds
$Unpacked = Expand-ServerArchive $Archive $CLI_STAGING
if ($ARCHIVE_PATH -eq '') {
  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
}
$Staged = [System.IO.Path]::Combine($CLI_STAGING, $LAUNCHER)
if (-not $Unpacked -or -not (Test-Path -LiteralPath $Staged -PathType Leaf)) {
  Clear-Staging
  Exit-Step 'UnpackFailed'
}
try {
  Move-Item -LiteralPath $Staged -Destination $CLI_FILE -Force -ErrorAction Stop
} catch {
  Clear-Staging
  Exit-Step 'UnpackFailed'
}
Clear-Staging
Add-Fact 'cli.path' $CLI_FILE
Add-Fact 'timing.download' ([string](($DownloadedAt - $StartedAt) * 1000))
Add-Fact 'timing.install' ([string](Get-ElapsedMilliseconds $DownloadedAt))
Exit-Step 'Ok'
