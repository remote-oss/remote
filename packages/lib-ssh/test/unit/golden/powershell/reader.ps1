[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Stream = [Console]::OpenStandardInput()
if ($PSVersionTable.PSVersion.Major -lt 6) { try { $Stream = New-Object System.IO.FileStream($Stream.GetType().GetField('_handle', [Reflection.BindingFlags]'NonPublic,Instance').GetValue($Stream), [IO.FileAccess]::Read, 1, $true) } catch {} }
$Bytes = New-Object byte[] 1
$Read = 0
while ($Read -lt 1) { $Count = $Stream.Read($Bytes, $Read, 1 - $Read); if ($Count -le 0) { break }; $Read += $Count }
& ([ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString($Bytes, 0, $Read)))