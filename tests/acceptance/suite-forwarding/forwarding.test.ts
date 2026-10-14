import {deepStrictEqual, match, strictEqual} from 'node:assert';
import {lstatSync} from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import {connectionLog, onHost} from '../suite/harness.ts';
import {agentAdd, fingerprintOf} from '../windows/harness.ts';

/** The case of this launch: `agent`, `agent-off` or `x11`. */
const FORWARDING_CASE = process.env.HARNESS_FORWARDING_CASE ?? '';

/** How long a terminal of the window has to write what it saw. */
const TERMINAL_MILLISECONDS = 15_000;

/** The form of an agent link's path. */
const LINK_PATTERN = '/tmp/vscode-ssh-auth-sock-*';

/** The log lines of this window's forwarding plans, which a failed assertion shows. */
function forwardingLines(): string {
  return connectionLog()
    .filter(line => line.includes('forwarding'))
    .join('\n');
}

/**
 * Runs `command` in a new terminal of the window, its output going to `file` of the harness home folder, and returns
 * that output once the command has ended, within the terminal's time. The file is removed first, so an earlier
 * launch's is never read.
 */
async function terminalWrites(command: string, file: string): Promise<string> {
  const written = path.posix.join('/home/harness', file);
  await onHost('rm', '-f', written, `${written}.done`);
  const terminal = vscode.window.createTerminal({name: 'forwarding'});
  terminal.sendText(`{ ${command}; } > ${written} 2>&1; touch ${written}.done`);
  const ending = Date.now() + TERMINAL_MILLISECONDS;
  try {
    while (Date.now() < ending) {
      const done = await onHost(
        'sh',
        '-c',
        `test -e ${written}.done && cat ${written}`,
      ).catch(() => undefined);
      if (done !== undefined) {
        return done.trim();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally {
    terminal.dispose();
  }
  throw new Error(
    `the terminal wrote no ${file} within ${String(TERMINAL_MILLISECONDS)} ms\n${forwardingLines()}`,
  );
}

/** The agent links in /tmp of the host, each with its owner, as `<owner> <path>`. */
async function hostLinks(): Promise<string[]> {
  const listed = await onHost(
    'sh',
    '-c',
    `for name in ${LINK_PATTERN}; do [ -L "$name" ] && stat -c '%U %n' "$name"; done; true`,
  );
  return listed.split('\n').filter(line => line !== '');
}

/**
 * The log lines of the read-back of the link at `linkPath`, once one is there, within the terminal's time: the
 * extension reads the link after its terminal ended, and logs what it found.
 */
async function linkChecked(linkPath: string): Promise<string[]> {
  const ending = Date.now() + TERMINAL_MILLISECONDS;
  let lines: string[] = [];
  while (lines.length === 0 && Date.now() < ending) {
    lines = connectionLog().filter(line =>
      line.startsWith(`the agent link ${linkPath} `),
    );
    if (lines.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  return lines;
}

/** Whether `file` exists on the client, as a link or anything else: a link made on the host never does. */
function existsOnClient(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/** The rows of each case, registered only in the launch of that case. */
const ROWS: Readonly<Record<string, () => void>> = {
  agent: () => {
    it('F-2311 AC-2, AC-3, AC-13: a window with ForwardAgent gets the agent in its terminals, through a link made on the host', async () => {
      const keyFile = path.join(
        process.env.HARNESS_RUN_FOLDER ?? '',
        'id_second',
      );
      await agentAdd(keyFile, {confirm: false});
      const socket = await terminalWrites(
        'for attempt in $(seq 1 40); do [ -S "$SSH_AUTH_SOCK" ] && break; sleep 0.25; done; echo "$SSH_AUTH_SOCK"',
        'agent-sock.txt',
      );
      const keys = await terminalWrites('ssh-add -l', 'agent-keys.txt');
      const links = await hostLinks();
      const target = await onHost('readlink', socket).catch(() => '');
      const checked = await linkChecked(socket);
      deepStrictEqual(
        {
          links,
          isLink: /^\/tmp\/vscode-ssh-auth-sock-\d+$/.test(socket),
          targetsSession: /^\/tmp\/ssh-[^/]+\/agent\.\d+$/.test(target.trim()),
          onClient: existsOnClient(socket),
          checked,
          listsKey: keys.includes(await fingerprintOf(keyFile)),
        },
        {
          links: [`harness ${socket}`],
          isLink: true,
          targetsSession: true,
          onClient: false,
          checked: [`the agent link ${socket} points at ${target.trim()}`],
          listsKey: true,
        },
        `${socket}\n${keys}\n${forwardingLines()}`,
      );
    });

    after(async () => {
      // The next launch, with the setting false, must find no link of this one.
      await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    });
  },
  'agent-off': () => {
    it('F-2311 AC-10: the setting false makes no link', async () => {
      const socket = await terminalWrites(
        'echo "$SSH_AUTH_SOCK"',
        'agent-off-sock.txt',
      );
      deepStrictEqual(
        {socket, links: await hostLinks()},
        {socket: '', links: []},
        forwardingLines(),
      );
    });
  },
  ['x11']: () => {
    it('F-2312 AC-2, AC-9: a window with ForwardX11 gets the display in its terminals', async () => {
      const display = await terminalWrites('echo "$DISPLAY"', 'display.txt');
      match(display, /^localhost:\d+\.0$/, forwardingLines());
    });
  },
};

describe(`the forwarding of a window (${FORWARDING_CASE})`, () => {
  it('connect-39: the launch names one of the forwarding cases', () => {
    strictEqual(FORWARDING_CASE in ROWS, true);
  });

  ROWS[FORWARDING_CASE]?.();
});
