/**
 * @fileoverview The server's life on the run's Windows SSH host (card #3333, ruling-3325-windows-start): started through
 * Win32_Process Create, it outlives the connection that started it, a later connect reuses it, and it carries the
 * start session's environment. The rows that end it from a new connection, the start's fallback and the CLI's rows
 * follow on the same card.
 */

import {deepStrictEqual} from 'node:assert';
import {
  connectionLog,
  hostAnswer,
  runShellTask,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {runWith} from '../windows/maintenance.ts';
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

/** The processIds of process `processId` and of all its descendants on the host, one per line. */
async function treeIds(processId: string): Promise<string[]> {
  return (
    await onWinhost(
      `$All = Get-CimInstance Win32_Process; function Tree($Id) { $Id; $All | Where-Object { $_.ParentProcessId -eq $Id } | ForEach-Object { Tree $_.ProcessId } }; Tree ${processId}`,
    )
  )
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[0-9]+$/.test(line));
}

/** Whether any of `processIds` still runs on the host. */
async function anyRuns(processIds: readonly string[]): Promise<boolean> {
  return (
    (
      await onWinhost(
        `@(${processIds.join(',')}) | ForEach-Object { if (Get-Process -Id $_ -ErrorAction SilentlyContinue) { 'yes' } } | Select-Object -First 1`,
      )
    ).trim() === 'yes'
  );
}

describe('Kill VS Code Server on the Windows host, from a new connection (card #3333)', function () {
  this.timeout(900_000);

  it('#3333: the server and its whole tree are gone within 5 s of the kill, and the next connect starts a new one', async () => {
    await connectedOnWinhost('winhost', 'r3333-kill', () => true);
    await noHelperSsh();
    const before = await recordedServer();
    const processId = before.split(' ')[0] ?? '';
    const tree = await treeIds(processId);
    readout(
      `before the kill: server pid file [${before}], tree [${tree.join(',')}]`,
    );
    await runWith('local', 'opensshremotes.cleanRemoteServer', [
      hostAnswer('local', {label: 'winhost'}),
    ]);
    const ended = Date.now();
    await waitFor(
      'the server and its tree to end',
      async () => !(await anyRuns(tree)),
      5_000,
    ).catch(() => undefined);
    const gone = !(await anyRuns(tree));
    readout(
      `the tree is gone ${String(Date.now() - ended)} ms after the kill finished: ${String(gone)}`,
    );
    await connectedOnWinhost('winhost', 'r3333-after-kill', () => true);
    await noHelperSsh();
    const after = await recordedServer();
    readout(`after the next connect: server pid file [${after}]`);
    deepStrictEqual(
      [tree.length > 0, gone, after !== '' && after !== before],
      [true, true, true],
    );
  });
});

describe('the start without WMI on the Windows host (card #3333)', function () {
  this.timeout(900_000);
  let kept = {start: '', status: ''};

  /** The service's start type and status, as the host reads them. */
  async function winmgmt(): Promise<{start: string; status: string}> {
    const [start = '', status = ''] = (
      await onWinhost(
        '$Service = Get-Service winmgmt; [string]$Service.StartType; [string]$Service.Status',
      )
    )
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    return {start, status};
  }

  afterEach(async () => {
    if (kept.start === '') {
      return;
    }
    await onWinhost(
      `Set-Service -Name winmgmt -StartupType ${kept.start}; if ('${kept.status}' -eq 'Running') { Start-Service -Name winmgmt }`,
    );
    await waitFor(
      'CIM to answer again',
      async () => {
        try {
          return (
            (
              await onWinhost(
                "if (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue) { 'yes' }",
              )
            ).trim() === 'yes'
          );
        } catch {
          return false;
        }
      },
      120_000,
    );
    kept = {start: '', status: ''};
  });

  it('#3333: with WMI stopped and disabled the connect still succeeds, the log tells once that the server started inside the session, and the server ends with the connection', async () => {
    await runWith('local', 'opensshremotes.cleanRemoteServer', [
      hostAnswer('local', {label: 'winhost'}),
    ]);
    kept = await winmgmt();
    await onWinhost(
      'Set-Service -Name winmgmt -StartupType Disabled; Stop-Service -Name winmgmt -Force',
    );
    const disabled = await winmgmt();
    const mark = connectionLog().length;
    await connectedOnWinhost('winhost', 'r3333-fallback', () => true);
    await noHelperSsh();
    const recorded = await recordedServer();
    const processId = recorded.split(' ')[0] ?? '';
    const lines = connectionLog()
      .slice(mark)
      .filter(line => line.includes('was started inside the connection'));
    await waitFor(
      'the server to end with its connection',
      async () => (await runs(processId)) === 'no',
      60_000,
    ).catch(() => undefined);
    const after = await runs(processId);
    readout(
      `WMI ${JSON.stringify(disabled)}; fallback lines ${JSON.stringify(lines)}; server ${processId} running after the connection ended: ${after}`,
    );
    deepStrictEqual(
      [disabled, lines.length, after],
      [{start: 'Disabled', status: 'Stopped'}, 1, 'no'],
    );
  });
});
