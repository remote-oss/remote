import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  agentAdd,
  closeWindow,
  connectedWithin,
  fingerprintOf,
  onHost,
  recordLines,
  runShellTask,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {freshHost, INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {printedAfter, windowWithTerminal} from '../windows/terminal-support.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';
import {hostLinks, LINK_PATTERN} from '../windows/agent-links.ts';

/** The alias that forwards the run's agent. */
const FORWARDING = 'agentfwd';

/** The alias with no ForwardAgent. */
const PLAIN = 'harness';

/** The alias with ForwardAgent no. */
const FORWARD_NO = 'agentfwd-no';

/** What `ssh-add -l` prints with no agent in reach. */
const NO_AGENT = 'Could not open a connection to your authentication agent.';

/** The surfaces that would show the user something. */
const SHOWN_SURFACES = [
  'notice',
  'failureDialog',
  'inputBox',
  'hostPick',
  'mitigationPick',
];

/** The form of the socket sshd gives a session. */
const SESSION_SOCKET = /^\/tmp\/ssh-[^/]+\/agent\.\d+$/;

/** The key of the run that the agent holds in the rows that list it. */
function keyFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'id_second');
}

/** Opens window `name` on `alias` on a host with no server, with a terminal, and waits for the connect. */
async function connectedOn(alias: string, name: string): Promise<void> {
  await freshHost();
  await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
  await windowWithTerminal(name, alias);
  await connectedWithin(name, INSTALL_MILLISECONDS);
}

/** The SSH_AUTH_SOCK the host's server was started with, the socket sshd gave the session that started it. */
async function serverSessionSocket(): Promise<string> {
  return (
    await onHost(
      'sh',
      '-c',
      `for pid in $(pgrep -f '[.]vscodium-server-insiders/bin/'); do tr '\\0' '\\n' < /proc/$pid/environ 2>/dev/null | sed -n 's/^SSH_AUTH_SOCK=//p'; done | head -1`,
    )
  ).trim();
}

/** What a new terminal of window `name` lists with `ssh-add -l`, once it has printed. */
async function listedKeys(name: string): Promise<string> {
  return printedAfter(
    name,
    'KEYS',
    '$(ssh-add -l 2>&1 | head -1 | tr " " "_")',
  );
}

describe('F-2311, SSH agent forwarding into the remote environment (card coverage-99)', function () {
  this.timeout(300_000);

  after(async () => {
    // The next file's rows start a server of their own, not one a forwarding session started.
    await freshHost();
  });

  it('F-2311 AC-2 (c99-link): a window on a host entry with ForwardAgent yes has, within 2 s of the indicator, a link owned by the remote user that points at the socket sshd gave the session', async () => {
    await agentAdd(keyFile(), {confirm: false});
    await connectedOn(FORWARDING, 'c99-link');
    try {
      let links: string[] = [];
      await waitFor(
        'the agent link',
        async () => {
          links = await hostLinks();
          return links.length > 0;
        },
        2000,
      ).catch(() => undefined);
      const target = (
        await onHost('readlink', links[0]?.split(' ')[1] ?? '').catch(() => '')
      ).trim();
      deepStrictEqual(
        {
          owners: links.map(link => link.split(' ')[0]),
          single: links.length,
          pointsAtSession: SESSION_SOCKET.test(target),
          sameAsServer: target === (await serverSessionSocket()),
        },
        {
          owners: ['harness'],
          single: 1,
          pointsAtSession: true,
          sameAsServer: true,
        },
        `${links.join(',')} -> ${target}`,
      );
    } finally {
      await closeWindow('c99-link').catch(() => undefined);
    }
  });

  it('F-2311 AC-4 (c99-task): a shell task of the window prints SSH_AUTH_SOCK as the link and ssh-add -l lists the key', async () => {
    await agentAdd(keyFile(), {confirm: false});
    await connectedOn(FORWARDING, 'c99-task');
    try {
      const written = '/home/harness/c99-task.txt';
      await onHost('rm', '-f', written);
      const exit = await runShellTask(
        'c99-task',
        `{ echo "$SSH_AUTH_SOCK"; ssh-add -l; } > ${written} 2>&1`,
      );
      const [socket = '', ...listed] = (await onHost('cat', written))
        .trim()
        .split('\n');
      deepStrictEqual(
        {
          exit,
          isLink: /^\/tmp\/vscode-ssh-auth-sock-\d+$/.test(socket),
          listsKey: listed.join('\n').includes(await fingerprintOf(keyFile())),
        },
        {exit: 0, isLink: true, listsKey: true},
      );
    } finally {
      await closeWindow('c99-task').catch(() => undefined);
    }
  });

  it('F-2311 AC-7 (c99-silent): the connect of a window with ForwardAgent shows no notification, dialog, input or pick of this feature', async () => {
    await connectedOn(FORWARDING, 'c99-silent');
    try {
      deepStrictEqual(
        recordLines(undefined, 'c99-silent')
          .map(line => line.surface)
          .filter(surface => SHOWN_SURFACES.includes(surface)),
        [],
      );
    } finally {
      await closeWindow('c99-silent').catch(() => undefined);
    }
  });

  it('F-2311 AC-10 (c99-setting-off): with the setting false on a host with no server, there is no link and a new terminal has the socket of the session that started the server', async () => {
    await keepingSettings(async () => {
      await userSettings({'remote.SSH.enableAgentForwarding': false});
      await connectedOn(FORWARDING, 'c99-setting-off');
      try {
        const socket = await printedAfter(
          'c99-setting-off',
          'SOCK',
          '$SSH_AUTH_SOCK',
        );
        deepStrictEqual(
          {
            links: await hostLinks(),
            sessionSocket: SESSION_SOCKET.test(socket),
          },
          {links: [], sessionSocket: true},
          socket,
        );
      } finally {
        await closeWindow('c99-setting-off').catch(() => undefined);
      }
    });
  });

  /** A window on `alias` on a fresh server has no link, and `ssh-add -l` in its new terminal says no agent is reachable. */
  async function noAgent(alias: string, label: string): Promise<void> {
    await connectedOn(alias, label);
    try {
      deepStrictEqual(
        {links: await hostLinks(), listed: await listedKeys(label)},
        {links: [], listed: NO_AGENT.replaceAll(' ', '_')},
      );
    } finally {
      await closeWindow(label).catch(() => undefined);
    }
  }

  it('F-2311 AC-11 (c99-no-forward): with ForwardAgent unset there is no link and ssh-add -l in a new terminal on a fresh server prints that no agent is reachable', async () => {
    await noAgent(PLAIN, 'c99-no-forward');
  });

  it('F-2311 AC-11 (c99-forward-no): with ForwardAgent no there is no link and ssh-add -l in a new terminal on a fresh server prints that no agent is reachable', async () => {
    await noAgent(FORWARD_NO, 'c99-forward-no');
  });

  it('F-2311 AC-21 (c99-links-stay): the link of a window that closed is still in /tmp', async () => {
    await connectedOn(FORWARDING, 'c99-links-stay');
    const before = await hostLinks();
    await closeWindow('c99-links-stay');
    deepStrictEqual(
      {before: before.length, after: await hostLinks()},
      {before: 1, after: before},
    );
  });
});
