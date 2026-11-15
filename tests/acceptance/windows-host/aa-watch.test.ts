/**
 * @fileoverview Measure branch only: starts a watcher that records the host's PowerShell and ssh processes every half
 * second while the connects run, for the replay file to print.
 */

import {spawn} from 'node:child_process';
import path from 'node:path';
import {variable} from '../windows/harness.ts';

describe('the host process watcher (card #2681, measurement)', () => {
  it('starts the watcher', () => {
    const outFile = path.join(variable('HARNESS_RUN_FOLDER'), 'process-watch.txt');
    const script = [
      `$Out = '${outFile.replace(/'/g, "''")}'`,
      '$End = (Get-Date).AddMinutes(6)',
      'while ((Get-Date) -lt $End) {',
      '  $Now = (Get-Date).ToString("HH:mm:ss.fff")',
      "  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'powershell|pwsh|sshd|ssh|cmd' } | ForEach-Object { \"$Now $($_.ProcessId) $($_.ParentProcessId) $($_.Name) $(([string]$_.CommandLine).Substring(0, [Math]::Min(120, ([string]$_.CommandLine).Length)))\" } | Add-Content -LiteralPath $Out",
      '  Start-Sleep -Milliseconds 500',
      '}',
    ].join('\n');
    const watcher = spawn('powershell', ['-NoProfile', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    watcher.unref();
  });
});
