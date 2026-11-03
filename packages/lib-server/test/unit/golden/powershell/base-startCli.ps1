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
function Get-CliReadyPort {
  $Found = Select-String -LiteralPath $CliLog -Pattern '^Listening on 127\.0\.0\.1:([0-9]+)$' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $Found) {
    return ''
  }
  return $Found.Matches[0].Groups[1].Value
}
function Get-ParentProcessId {
  try {
    Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RemoteOssParentProcess {
  [StructLayout(LayoutKind.Sequential)]
  private struct BasicInformation {
    public IntPtr ExitStatus;
    public IntPtr PebBaseAddress;
    public IntPtr AffinityMask;
    public IntPtr BasePriority;
    public IntPtr UniqueProcessId;
    public IntPtr InheritedFromUniqueProcessId;
  }
  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(IntPtr process, int informationClass, ref BasicInformation information, int length, out int returned);
  public static long Of(IntPtr process) {
    BasicInformation information = new BasicInformation();
    int returned;
    int status = NtQueryInformationProcess(process, 0, ref information, Marshal.SizeOf(information), out returned);
    return status == 0 ? information.InheritedFromUniqueProcessId.ToInt64() : 0;
  }
}
'@
    return [long][RemoteOssParentProcess]::Of((Get-Process -Id $PID).Handle)
  } catch {
    return 0
  }
}
function Get-CurrentUserSid {
  return [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
}
function Get-TokenPrincipals {
  return @((Get-CurrentUserSid), 'S-1-5-18', 'S-1-5-32-544')
}
function Test-TokenAccess([string]$File) {
  $Allowed = Get-TokenPrincipals
  foreach ($Entry in @((Get-Acl -LiteralPath $File).Access)) {
    if ([string]$Entry.AccessControlType -ne 'Allow' -or ([long]$Entry.FileSystemRights -band 0xD00C0007) -eq 0) {
      continue
    }
    if ($Allowed -notcontains $Entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
      return $false
    }
  }
  return $true
}
function Set-TokenAcl([string]$File) {
  $Security = New-Object System.Security.AccessControl.FileSecurity
  $Security.SetAccessRuleProtection($true, $false)
  foreach ($Principal in Get-TokenPrincipals) {
    $Security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier $Principal), 'FullControl', 'Allow')))
  }
  Set-Acl -LiteralPath $File -AclObject $Security
}
function Test-ConnectionToken([string]$File) {
  $Item = Get-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
  if ($null -eq $Item -or $Item.PSIsContainer -or ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    return $false
  }
  if ([System.IO.File]::ReadAllText($File) -cnotmatch '^[0-9A-Za-z_-]{1,128}$') {
    return $false
  }
  try {
    return (Test-TokenAccess $File)
  } catch {
    return $false
  }
}
function Write-ConnectionToken([string]$File) {
  $Part = $File + '.' + $PID
  [System.IO.File]::WriteAllText($Part, '')
  Set-TokenAcl $Part
  [System.IO.File]::WriteAllText($Part, (New-Secret))
  if (Test-Path -LiteralPath $File) {
    Remove-Item -LiteralPath $File -Force -ErrorAction Stop
  }
  Move-Item -LiteralPath $Part -Destination $File -ErrorAction Stop
}
if (-not (Test-Path -LiteralPath $CLI_FILE -PathType Leaf)) {
  Complete-Step 'ServerFailedToStart'
}
if (-not $env:VSCODE_CLI_REQUIRE_TOKEN) {
  Add-Fact 'cli.tokenMissing' 'yes'
  Complete-Step 'ServerFailedToStart'
}
$TokenFile = [System.IO.Path]::Combine($CLI_DATA, 'connection-token')
try {
  New-Folder $CLI_DATA
  if (-not (Test-ConnectionToken $TokenFile)) {
    Write-ConnectionToken $TokenFile
  }
} catch {
  Complete-Step 'ServerFailedToStart'
}
if (-not (Test-ConnectionToken $TokenFile)) {
  Add-Fact 'cli.tokenInvalid' 'yes'
  Complete-Step 'ServerFailedToStart'
}
Add-Fact 'cli.connectionToken' ([System.IO.File]::ReadAllText($TokenFile))
$CliLog = [System.IO.Path]::Combine($DATA_DIR, '.cli.' + $COMMIT + '.log')
$CliArguments = 'command-shell --on-host 127.0.0.1 --on-port 0 --cli-data-dir "' + $CLI_DATA + '"'
$Parent = Get-ParentProcessId
if ($Parent -gt 0) {
  $CliArguments = $CliArguments + ' --parent-process-id ' + $Parent
  Add-Fact 'cli.parent' 'native'
} else {
  Add-Fact 'cli.parent' 'none'
}
try {
  [System.IO.File]::WriteAllText($CliLog, '')
  $CliProcess = Start-Program @{FilePath = $CLI_FILE; ArgumentList = $CliArguments; PassThru = $true; RedirectStandardOutput = $CliLog; RedirectStandardError = ($CliLog + '.err')}
} catch {
  Complete-Step 'ServerFailedToStart'
}
for ($Waited = 0; $Waited -lt ([int]$READY_SECONDS * 5); $Waited++) {
  $CliPort = Get-CliReadyPort
  if ($CliPort -ne '') {
    Add-Fact 'cli.port' $CliPort
    Add-Fact 'cli.pid' ([string]$CliProcess.Id)
    Add-Fact 'cli.log' $CliLog
    Complete-Step 'Ok'
  }
  if ($CliProcess.HasExited) {
    Complete-Step 'ServerFailedToStart'
  }
  Start-Sleep -Milliseconds 200
}
Stop-Process -Id $CliProcess.Id -Force -ErrorAction SilentlyContinue
Complete-Step 'ServerFailedToStart'
