/**
 * @fileoverview The session a Windows host runs for `ShellRuns`: a fixed PowerShell loop, the twin of the POSIX
 * bootstrap. It prints `LAYER1-READY`, then for each framed run on its standard input starts a child PowerShell that
 * reads the run's prelude with the direct channel's reader, feeds it the run's input, and copies its output between the
 * run's markers. The child's command line holds only the reader, never a value of the run.
 */

import type {Interpreter, PlatformHint} from 'lib-host';
import {
  powershellPrelude,
  powershellReader,
} from '../process/remote-program.ts';

/** The token in the loop's copy of the reader that each run's prelude length replaces. */
const PRELUDE_BYTES_TOKEN = 'PRELUDE_BYTES';

/** The words in front of an encoded command, for the session and for each run's child. */
const POWERSHELL_WORDS = '-NoLogo -NoProfile -NonInteractive -EncodedCommand';

/**
 * The loop. `$ChildProgram` is `powershell.exe` on a Windows host; only the rows that run it under `pwsh` on Linux
 * pass another. A header that doesn't parse, or input that ends inside a run, ends the session with status 2; the end
 * of the input between runs ends it with 0.
 */
export const POWERSHELL_SESSION_LOOP = [
  "param([string]$ChildProgram = 'powershell.exe')",
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$Stream = [Console]::OpenStandardInput()',
  `$ReaderText = '${powershellReader(PRELUDE_BYTES_TOKEN)}'`,
  'function Read-Exactly([int]$Count) {',
  '  $Buffer = New-Object byte[] $Count',
  '  $Read = 0',
  '  while ($Read -lt $Count) {',
  '    $Got = $Stream.Read($Buffer, $Read, $Count - $Read)',
  '    if ($Got -le 0) { exit 2 }',
  '    $Read += $Got',
  '  }',
  '  return ,$Buffer',
  '}',
  '[Console]::Out.Write("LAYER1-READY`n")',
  '[Console]::Out.Flush()',
  'while ($true) {',
  '  $Header = New-Object System.Collections.Generic.List[byte]',
  '  while ($true) {',
  '    $Byte = $Stream.ReadByte()',
  '    if ($Byte -lt 0) { if ($Header.Count -eq 0) { exit 0 } else { exit 2 } }',
  '    if ($Byte -eq 10) { break }',
  '    $Header.Add([byte]$Byte)',
  '  }',
  "  $Fields = [System.Text.Encoding]::ASCII.GetString($Header.ToArray()).TrimEnd([char]13).Split(' ')",
  "  if ($Fields.Count -ne 3 -or $Fields[1] -notmatch '^[0-9]+$' -or $Fields[2] -notmatch '^[0-9]+$') { exit 2 }",
  '  $Prelude = Read-Exactly ([int]$Fields[1])',
  '  $InputBytes = [Convert]::FromBase64String([System.Text.Encoding]::ASCII.GetString((Read-Exactly ([int]$Fields[2]))))',
  '  [Console]::Out.Write("$($Fields[0]):start`n")',
  '  [Console]::Out.Flush()',
  `  $Reader = $ReaderText.Replace('${PRELUDE_BYTES_TOKEN}', [string]$Prelude.Length)`,
  '  $Info = New-Object System.Diagnostics.ProcessStartInfo',
  '  $Info.FileName = $ChildProgram',
  `  $Info.Arguments = '${POWERSHELL_WORDS} ' + [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Reader))`,
  '  $Info.UseShellExecute = $false',
  '  $Info.RedirectStandardInput = $true',
  '  $Info.RedirectStandardOutput = $true',
  '  $Info.StandardOutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '  $Child = [System.Diagnostics.Process]::Start($Info)',
  '  $ChildInput = $Child.StandardInput.BaseStream',
  '  $ChildInput.Write($Prelude, 0, $Prelude.Length)',
  '  $ChildInput.Write($InputBytes, 0, $InputBytes.Length)',
  '  $ChildInput.Close()',
  '  while ($null -ne ($Line = $Child.StandardOutput.ReadLine())) { [Console]::Out.Write("$Line`n") }',
  '  $Child.WaitForExit()',
  '  [Console]::Out.Write("$($Fields[0]):end $($Child.ExitCode)`n")',
  '  [Console]::Out.Flush()',
  '}',
].join('\n');

/** An encoded command: PowerShell's words and `text` as base64 of its UTF-16LE bytes. */
function encodedCommand(program: string, text: string): string {
  return `${program} ${POWERSHELL_WORDS} ${Buffer.from(text, 'utf16le').toString('base64')}`;
}

/**
 * The remote command of a Windows session that `ShellRuns` writes to, and its prelude, which is empty: the loop needs
 * no bootstrap, a Windows session's environment being the logon's.
 */
export function powershellSessionStart(): {
  remoteProgram: string;
  prelude: string;
} {
  return {
    remoteProgram: encodedCommand('powershell', POWERSHELL_SESSION_LOOP),
    prelude: '',
  };
}

/**
 * The framed run the loop reads: the header `<marker> <prelude bytes> <input characters>`, the prelude (the run's
 * environment and script, as the direct channel's reader takes them), then the input as base64, empty for none.
 */
export function powershellCommandsFor(
  marker: string,
  request: {
    script: string;
    environment: Readonly<Record<string, string>>;
    inputBase64: string | null;
  },
): string {
  const prelude = powershellPrelude(request.environment, request.script);
  const input = request.inputBase64 ?? '';
  return `${marker} ${String(Buffer.byteLength(prelude, 'utf8'))} ${String(input.length)}\n${prelude}${input}`;
}

/** What a session runs its scripts with on a host of `platform`: PowerShell on Windows, a POSIX `sh` otherwise. */
export function interpreterOfPlatform(platform: PlatformHint): Interpreter {
  return platform === 'windows' ? 'powershell' : 'posixShell';
}
