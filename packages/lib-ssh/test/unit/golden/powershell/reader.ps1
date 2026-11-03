[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Stream = [Console]::OpenStandardInput()
$Bytes = New-Object byte[] 1
$Read = 0
while ($Read -lt 1) { $Count = $Stream.Read($Bytes, $Read, 1 - $Read); if ($Count -le 0) { break }; $Read += $Count }
& ([ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString($Bytes, 0, $Read)))