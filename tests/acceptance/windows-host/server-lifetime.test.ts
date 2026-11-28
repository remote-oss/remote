/**
 * @fileoverview The server's life on the run's Windows SSH host (card #3333, ruling-3325-windows-start): started through
 * Win32_Process Create, it outlives the connection that started it, a later connect reuses it, and it carries the
 * start session's environment. The rows that end it from a new connection, the start's fallback and the CLI's rows
 * follow on the same card.
 */

import {deepStrictEqual} from 'node:assert';
import {runShellTask, windowState} from '../windows/harness.ts';
import {
  connectedOnWinhost,
  noHelperSsh,
  onWinhost,
  whileConnectedOnWinhost,
} from './winhost-support.ts';

/** The pid and start ticks the newest server pid file of the host records, or empty. */
async function recordedServer(): Promise<string> {
  return (
    await onWinhost(
      "$File = Get-ChildItem -Path $HOME -Directory -Force | Where-Object { $_.Name -like '.*server*' } | ForEach-Object { Get-ChildItem -Path $_.FullName -File -Force } | Where-Object { $_.Name -match '^\\.[0-9a-f]{40}\\.pid$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($File) { Get-Content -LiteralPath $File.FullName -TotalCount 1 }",
    )
  ).trim();
}

/** Whether process `processId` runs on the host, as `yes` or `no`. */
async function runs(processId: string): Promise<string> {
  return (
    await onWinhost(
      `if (Get-Process -Id ${processId} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`,
    )
  ).trim();
}

/** A line of the run's readout: the time and what was seen. */
function readout(what: string): void {
  process.stdout.write(`readout ${new Date().toISOString()} ${what}\n`);
}

/** Waits `seconds`. */
function wait(seconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, seconds * 1000);
  });
}

describe('the server on the run’s Windows SSH host outlives its connection (card #3333)', function () {
  this.timeout(900_000);
  let recorded = '';

  it('F-2302 AC-9: the server is still running 60 s after the last connection ended', async () => {
    await connectedOnWinhost('winhost', 'r3333-life', () => true);
    await noHelperSsh();
    recorded = await recordedServer();
    const processId = recorded.split(' ')[0] ?? '';
    readout(`server pid file after the connection ended: [${recorded}]`);
    const first = await runs(processId);
    await wait(60);
    const later = await runs(processId);
    readout(
      `server ${processId} running: right after ${first}, 60 s later ${later}`,
    );
    deepStrictEqual(
      [/^[0-9]+ [0-9]+$/.test(recorded), first, later],
      [true, 'yes', 'yes'],
    );
  });

  it('F-2302 AC-9: a later connect reuses that server, with the same pid and start time', async () => {
    await connectedOnWinhost('winhost', 'r3333-reuse', () => true);
    const again = await recordedServer();
    readout(
      `server pid file after the second connect: [${again}] (was [${recorded}])`,
    );
    deepStrictEqual(again, recorded);
  });

  it('#3333 (ruling-3325-windows-start): the server carries the start session’s environment: a task in the window sees SSH_CONNECTION of the start, not this session’s', async () => {
    const file = '$env:TEMP\\r3333-ssh-connection.txt';
    const seen = await whileConnectedOnWinhost(
      'winhost',
      'r3333-env',
      async name => {
        await runShellTask(
          name,
          `powershell -NoProfile -Command "Set-Content -LiteralPath ${file} -Value $env:SSH_CONNECTION"`,
        );
        readout(
          `window ${name}: ${JSON.stringify((await windowState(name)).remoteName)}`,
        );
        return (
          await onWinhost(
            `if (Test-Path -LiteralPath ${file}) { Get-Content -LiteralPath ${file} -TotalCount 1 }`,
          )
        ).trim();
      },
    );
    const own = (await onWinhost('$env:SSH_CONNECTION')).trim();
    readout(
      `SSH_CONNECTION in the window's task [${seen}]; in this new session [${own}]`,
    );
    deepStrictEqual(
      [/^[0-9.]+ [0-9]+ [0-9.]+ [0-9]+$/.test(seen), seen !== own],
      [true, true],
    );
  });
});
