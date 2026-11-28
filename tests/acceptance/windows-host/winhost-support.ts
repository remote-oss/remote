/**
 * @fileoverview What the rows of the run's Windows SSH host share: the connection helpers' `ssh` processes, a window
 * opened on the host and waited for, and commands run on the host over plain ssh.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectionLog,
  openWindow,
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
export function noHelperSsh(): Promise<void> {
  return waitFor(
    'no connection helper ssh to run',
    async () => (await helperSshCommands()).length === 0,
    60_000,
  );
}

/**
 * Opens window `name` on `alias` of the run's Windows host and waits until its connect resolved, with a helper's `ssh` seen meanwhile, and `ready`
 * holds; gives the helpers' `ssh` command lines and the log lines since the open, with the window closed again. A
 * window on a remote authority names the remote at once, before its connect resolves, so that alone says nothing.
 */
export async function connectedOnWinhost(
  alias: string,
  name: string,
  ready: (logged: readonly string[]) => boolean,
): Promise<{commands: string[]; logged: string[]}> {
  await noHelperSsh();
  const mark = connectionLog().length;
  const commands = new Set<string>();
  try {
    await openWindow(alias, name);
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

/** The output of the PowerShell `script` run on the host over plain ssh, in a new session. */
export async function onWinhost(script: string): Promise<string> {
  const {stdout} = await execFileAsync('ssh', [
    '-F',
    variable('HARNESS_SSH_CONFIG'),
    'winhost',
    script,
  ]);
  return stdout;
}

/** Opens window `name` on `alias`, waits until it is on the remote and has resolved, runs `body` with it open, then closes it. */
export async function whileConnectedOnWinhost<Result>(
  alias: string,
  name: string,
  body: (name: string) => Promise<Result>,
): Promise<Result> {
  await noHelperSsh();
  const mark = connectionLog().length;
  try {
    await openWindow(alias, name);
    await waitFor(
      `${name} to be on the remote`,
      async () =>
        (await windowState(name)).remoteName === 'ssh-remote' &&
        connectionLog()
          .slice(mark)
          .some(line => line.startsWith('Resolved ssh-remote+')),
      480_000,
    );
    return await body(name);
  } finally {
    await closeWindow(name).catch(() => undefined);
  }
}
