/**
 * @fileoverview What the rows of pseudo-terminal allocation read: the arguments of the `ssh` clients of the run, in
 * every mode, and how the host's sessions of the account were opened, with a terminal or without.
 */

import {readdirSync, readFileSync} from 'node:fs';
import {
  closeWindow,
  connectedWithin,
  connectionLog,
  onHost,
  openWindow,
  userSettings,
  variable,
  waitFor,
} from './harness.ts';
import {freshHost} from './maintenance.ts';
import {PLATFORMS} from './tunnel-support.ts';

/** The argument lists of the `ssh` processes of the run (those that name its ssh_config), as they are now. */
export function runSshArguments(): string[][] {
  const config = variable('HARNESS_SSH_CONFIG');
  const lists: string[][] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    let argv: string[];
    try {
      argv = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
        .split('\0')
        .filter(part => part !== '');
    } catch {
      // The process ended between the listing and the read.
      continue;
    }
    const program = argv[0] ?? '';
    if (
      (program === 'ssh' || program.endsWith('/ssh')) &&
      argv.includes(config)
    ) {
      lists.push(argv);
    }
  }
  return lists;
}

/** How the sessions of the account `harness` on the host are open now: `notty`, or the terminal they have, such as `pts/0`. */
export async function hostSessions(): Promise<string[]> {
  const output = await onHost(
    'sh',
    '-c',
    "ps -o args | grep '^sshd-session: harness@' | grep -v grep; true",
  );
  return output
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.slice(line.indexOf('@') + 1));
}

/** The process ids of the sessions of the account `harness` on the host now. */
export async function hostSessionIds(): Promise<string[]> {
  const output = await onHost(
    'sh',
    '-c',
    "ps -o pid,args | grep 'sshd-session: harness@' | grep -v grep; true",
  );
  return output
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0] ?? '')
    .filter(each => each !== '');
}

/** What a connect showed of its pseudo-terminal allocation. */
export interface PtyConnect {
  /** Whether the window connected. */
  connected: boolean;
  /** The distinct argument lists of the run's `ssh` processes seen while the connect ran. */
  commands: string[];
  /** The distinct terminals the host's sessions had while the connect ran. */
  sessions: string[];
  /** The lines the connection log gained. */
  logged: string[];
}

/**
 * Opens window `name` on `alias` with `settings` on a fresh host, watches the `ssh` processes and the host's sessions
 * for `watchMilliseconds` and closes the window.
 */
export async function ptyConnect(
  name: string,
  alias: string,
  settings: Readonly<Record<string, unknown>>,
  watchMilliseconds = 25_000,
): Promise<PtyConnect> {
  await userSettings({...PLATFORMS, ...settings});
  await freshHost();
  // The connection server of an earlier connect keeps its ssh for a grace after its window closed; a client of that
  // connect is not one of this connect's.
  await waitFor(
    'the ssh clients of earlier connects to end',
    () => Promise.resolve(runSshArguments().length === 0),
    90_000,
  );
  const mark = connectionLog().length;
  const commands = new Set<string>();
  const sessions = new Set<string>();
  await openWindow(alias, name);
  let connected = false;
  const watched = connectedWithin(name, watchMilliseconds).then(
    () => {
      connected = true;
    },
    () => undefined,
  );
  const end = Date.now() + watchMilliseconds;
  while (Date.now() < end) {
    for (const argv of runSshArguments()) {
      commands.add(argv.join(' '));
    }
    for (const session of await hostSessions()) {
      sessions.add(session);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  await watched;
  await closeWindow(name).catch(() => undefined);
  return {
    connected,
    commands: [...commands],
    sessions: [...sessions],
    logged: connectionLog().slice(mark),
  };
}

/** Whether an `ssh` argument list carries `-T`. */
export function hasNoTty(argv: string): boolean {
  return argv.split(' ').includes('-T');
}
