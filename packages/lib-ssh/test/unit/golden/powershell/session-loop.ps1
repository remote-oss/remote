param([string]$ChildProgram = 'powershell.exe')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Stream = [Console]::OpenStandardInput()
if ($PSVersionTable.PSVersion.Major -lt 6) { try { $Stream = New-Object System.IO.FileStream($Stream.GetType().GetField('_handle', [Reflection.BindingFlags]'NonPublic,Instance').GetValue($Stream), [IO.FileAccess]::Read, 1, $true) } catch {} }
$Out = [Console]::OpenStandardOutput()
$ReaderText = '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Stream = [Console]::OpenStandardInput()
$Bytes = New-Object byte[] PRELUDE_BYTES
$Read = 0
while ($Read -lt PRELUDE_BYTES) { $Count = $Stream.Read($Bytes, $Read, PRELUDE_BYTES - $Read); if ($Count -le 0) { break }; $Read += $Count }
& ([ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString($Bytes, 0, $Read)))'
function Read-Exactly([int]$Count) {
  $Buffer = New-Object byte[] $Count
  $Read = 0
  while ($Read -lt $Count) {
    $Got = $Stream.Read($Buffer, $Read, $Count - $Read)
    if ($Got -le 0) { exit 2 }
    $Read += $Got
  }
  return ,$Buffer
}
[Console]::Out.Write("`nLAYER1-READY`n")
[Console]::Out.Flush()
while ($true) {
  $Header = New-Object System.Collections.Generic.List[byte]
  while ($true) {
    $Byte = $Stream.ReadByte()
    if ($Byte -lt 0) { if ($Header.Count -eq 0) { exit 0 } else { exit 2 } }
    if ($Byte -eq 10) { break }
    $Header.Add([byte]$Byte)
  }
  $Fields = [System.Text.Encoding]::ASCII.GetString($Header.ToArray()).TrimEnd([char]13).Split(' ')
  if ($Fields.Count -ne 3 -or $Fields[1] -notmatch '^[0-9]{1,9}$' -or $Fields[2] -notmatch '^[0-9]{1,9}$') { exit 2 }
  $Prelude = Read-Exactly ([int]$Fields[1])
  $InputBytes = [Convert]::FromBase64String([System.Text.Encoding]::ASCII.GetString((Read-Exactly ([int]$Fields[2]))))
  [Console]::Out.Write("$($Fields[0]):start`n")
  [Console]::Out.Flush()
  $Reader = $ReaderText.Replace('PRELUDE_BYTES', [string]$Prelude.Length)
  $Info = New-Object System.Diagnostics.ProcessStartInfo
  $Info.FileName = $ChildProgram
  $Info.Arguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Reader))
  $Info.UseShellExecute = $false
  $Info.RedirectStandardInput = $true
  $Info.RedirectStandardOutput = $true
  $Child = [System.Diagnostics.Process]::Start($Info)
  $Copy = $Child.StandardOutput.BaseStream.CopyToAsync($Out)
  $ChildInput = $Child.StandardInput.BaseStream
  try {
    $ChildInput.Write($Prelude, 0, $Prelude.Length)
    $ChildInput.Write($InputBytes, 0, $InputBytes.Length)
    $ChildInput.Close()
  } catch {}
  $Child.WaitForExit()
  [void]$Copy.Wait(2000)
  $Out.Flush()
  [Console]::Out.Write("$($Fields[0]):end $($Child.ExitCode)`n")
  [Console]::Out.Flush()
}