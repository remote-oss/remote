/**
 * @fileoverview The run's Windows SSH host (card #2652): `winhost`, Windows' OpenSSH Server on 127.0.0.1, which the
 * platform workflow's Windows job starts with key authentication and Windows PowerShell as its shell. The first row
 * reaches it with plain `ssh` through the run's ssh_config, as the product's windows will; the second opens a window on
 * it with no platform stored, and the third with its platform stored as Windows and pseudo-terminals permitted.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectionLog,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';

const execFileAsync = promisify(execFile);

/** The command lines of this machine's `ssh` processes that forward a SOCKS port: the connection helpers' clients. */
async function helperSshCommands(): Promise<string[]> {
  const {stdout} = await execFileAsync('powershell', [
    '-NoProfile',
    '-Command',
    'Get-CimInstance Win32_Process -Filter "Name=\'ssh.exe\'" | ForEach-Object { $_.CommandLine }',
  ]);
  return stdout.split(/\r?\n/).filter(line => line.includes(' -D 127.0.0.1:'));
}

/** Waits until no connection helper's `ssh` runs, so that the next window starts its own. */
function noHelperSsh(): Promise<void> {
  return waitFor(
    'no connection helper ssh to run',
    async () => (await helperSshCommands()).length === 0,
    60_000,
  );
}

/**
 * Opens window `name` on winhost and waits until its connect resolved, with a helper's `ssh` seen meanwhile, and `ready`
 * holds; gives the helpers' `ssh` command lines and the log lines since the open, with the window closed again. A
 * window on a remote authority names the remote at once, before its connect resolves, so that alone says nothing.
 */
async function connectedOnWinhost(
  name: string,
  ready: (logged: readonly string[]) => boolean,
): Promise<{commands: string[]; logged: string[]}> {
  await noHelperSsh();
  const mark = connectionLog().length;
  const commands = new Set<string>();
  try {
    await openWindow('winhost', name);
    await waitFor(
      `${name} to be on the remote`,
      async () => {
        for (const command of await helperSshCommands()) {
          commands.add(command);
        }
        const logged = connectionLog().slice(mark);
        return (
          (await windowState(name)).remoteName === 'ssh-remote' &&
          logged.some(line => line.startsWith('Resolved ssh-remote+')) &&
          commands.size > 0 &&
          ready(logged)
        );
      },
      480_000,
    );
    return {commands: [...commands], logged: connectionLog().slice(mark)};
  } finally {
    await closeWindow(name).catch(() => undefined);
  }
}

describe('the Windows SSH host of the run (card #2652)', function () {
  this.timeout(60_000);

  it('contracts harness: winhost answers plain ssh through the run’s ssh_config with the run’s key, in Windows PowerShell', async () => {
    const {stdout} = await execFileAsync('ssh', [
      '-F',
      variable('HARNESS_SSH_CONFIG'),
      'winhost',
      '$PSVersionTable.PSEdition',
    ]);
    deepStrictEqual(stdout.trim(), 'Desktop');
  });

  it('F-2701 AC-1 (c1835-windows-detect): with no platform stored, a window on winhost asks no platform pick, the opening finds Windows, the log names it, and the window is on the remote', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    await userSettings({'remote.SSH.remotePlatform': {}});
    try {
      const {logged} = await connectedOnWinhost('c1835-win', lines =>
        lines.includes('Platform: windows'),
      );
      deepStrictEqual(
        [
          recordLines('platformPick', 'c1835-win'),
          logged.filter(line => line.startsWith('Platform: ')),
        ],
        [[], ['Platform: windows']],
      );
    } finally {
      restoreUserSettings(saved);
      await userSettings({});
    }
  });

  it('F-2106 AC-14 (ruling-1606-no-tty-warning): on a host decided as Windows, with the setting on and no RequestTTY in the shared mode, the connection command has no -T, ssh writes no warning, and the window connects', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    await userSettings({'remote.SSH.permitPtyAllocation': true});
    try {
      const {commands, logged} = await connectedOnWinhost(
        'r1606-win',
        () => true,
      );
      deepStrictEqual(
        [
          commands.length > 0,
          commands.some(command => command.split(' ').includes('-T')),
          logged.filter(line => line.includes('Pseudo-terminal')),
        ],
        [true, false, []],
      );
    } finally {
      restoreUserSettings(saved);
      await userSettings({});
    }
  });
});
