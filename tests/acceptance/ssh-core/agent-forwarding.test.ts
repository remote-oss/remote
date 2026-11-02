import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  agentAdd,
  closeWindow,
  connectedWithin,
  fingerprintOf,
  noHelperWithin,
  reloadWindow,
  onHost,
  onHostAs,
  openWindow,
  recordLines,
  runShellTask,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {freshHost, INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {statusItemText} from '../windows/renderer.ts';
import {contributionsNow, ownContributions} from '../windows/x11-support.ts';
import {
  listedKeys,
  printedAfter,
  windowWithTerminal,
} from '../windows/terminal-support.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';
import {
  hostLinks,
  LINK_PATTERN,
  serverSessionSocket,
} from '../windows/agent-links.ts';

/** The alias that forwards the run's agent. */
const FORWARDING = 'agentfwd';

/** The alias with no ForwardAgent. */
const PLAIN = 'harness';

/** The account whose login shell sets TMPDIR, and the alias that forwards the agent to it. */
const TMPDIR_USER = 'harness-tmpdir';
const TMPDIR_ALIAS = 'agentfwd-tmpdir';

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

/** The key of the run that the agent holds in the rows that list it. */
function keyFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'id_second');
}

/** Opens window `name` on `alias` on a host with no server, with a terminal, and waits for the connect. */
async function connectedOn(alias: string, name: string): Promise<void> {
  await freshHost();
  await onHostAs('root', 'sh', '-c', `rm -f ${LINK_PATTERN}`);
  await windowWithTerminal(name, alias);
  await connectedWithin(name, INSTALL_MILLISECONDS);
}

describe('F-2311, SSH agent forwarding into the remote environment (card coverage-99)', function () {
  this.timeout(300_000);

  after(async () => {
    // The next file's rows start a server of their own, not one a forwarding session started.
    await freshHost();
  });

  it('F-2311 AC-2 (c99-link): a window on a host entry with ForwardAgent yes has, within 2 s of the indicator reading SSH: agentfwd, a link owned by the remote user that points at the socket sshd gave the session, whatever its shape, with no terminal opened', async () => {
    await agentAdd(keyFile(), {confirm: false});
    await freshHost();
    await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    await openWindow(FORWARDING, 'c99-link');
    try {
      await statusItemText(
        'c99-link',
        'status.host',
        `SSH: ${FORWARDING}`,
        INSTALL_MILLISECONDS,
      );
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
          sameAsServer: target === (await serverSessionSocket()),
        },
        {
          owners: ['harness'],
          single: 1,
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

  it('F-2311 AC-10 (c99-setting-off): with the setting false on a host with no server, there is no link, the extension contributes no SSH_AUTH_SOCK, and a new terminal has the socket of the session that started the server', async () => {
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
            sessionSocket: socket === (await serverSessionSocket()),
            contributed: ownContributions(
              await contributionsNow('c99-setting-off'),
            ).filter(entry => entry.startsWith('SSH_AUTH_SOCK')),
          },
          {links: [], sessionSocket: true, contributed: []},
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

  it('F-2311 AC-6 (c99-contributions): the extension\u2019s own section of the environment contributions lists SSH_AUTH_SOCK with the number of the link', async () => {
    await connectedOn(FORWARDING, 'c99-contributions');
    try {
      const link = (await hostLinks())[0]?.split(' ')[1] ?? '';
      deepStrictEqual(
        ownContributions(await contributionsNow('c99-contributions')).filter(
          entry => entry.startsWith('SSH_AUTH_SOCK'),
        ),
        [`SSH_AUTH_SOCK=${link}`],
      );
    } finally {
      await closeWindow('c99-contributions').catch(() => undefined);
    }
  });

  /** What a new terminal of a window on the forwarding alias lists first, when the server was started by a session that has ended and the setting is `setting`. */
  async function listedAfterEndedSession(
    setting: boolean,
    label: string,
  ): Promise<string> {
    await agentAdd(keyFile(), {confirm: false});
    await freshHost();
    await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    await windowWithTerminal(`${label}-first`, FORWARDING);
    await connectedWithin(`${label}-first`, INSTALL_MILLISECONDS);
    await closeWindow(`${label}-first`);
    await noHelperWithin(60_000);
    await userSettings({'remote.SSH.enableAgentForwarding': setting});
    await windowWithTerminal(label, FORWARDING);
    try {
      await connectedWithin(label, INSTALL_MILLISECONDS);
      return await listedKeys(label);
    } finally {
      await closeWindow(label).catch(() => undefined);
    }
  }

  it('F-2311 AC-14 (c99-ended-true): on a server started by a session that has ended, with the setting true a new terminal lists the agent’s keys', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(
        (await listedAfterEndedSession(true, 'c99-ended-true')).includes(
          await fingerprintOf(keyFile()),
        ),
        true,
      );
    });
  });

  it('F-2311 AC-14 (c99-ended-false): on a server started by a session that has ended, with the setting false ssh-add -l prints that the agent socket does not exist', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(
        await listedAfterEndedSession(false, 'c99-ended-false'),
        'Error_connecting_to_agent:_No_such_file_or_directory',
      );
    });
  });

  it('F-2311 AC-17 (c99-reload): with the local server off, a reload makes a new link with a new name and the previous link stays', async () => {
    await keepingSettings(async () => {
      await userSettings({
        'remote.SSH.useLocalServer': false,
        'remote.SSH.remotePlatform': {[FORWARDING]: 'linux'},
      });
      await connectedOn(FORWARDING, 'c99-reload');
      try {
        const before = await hostLinks();
        await reloadWindow('c99-reload');
        await waitFor(
          'a second link',
          async () => (await hostLinks()).length > before.length,
          INSTALL_MILLISECONDS,
        ).catch(() => undefined);
        const after = await hostLinks();
        const [first = '', second = ''] = await Promise.all(
          [...before, ...after.filter(link => !before.includes(link))].map(
            async link =>
              (await onHost('readlink', link.split(' ')[1] ?? '')).trim(),
          ),
        );
        deepStrictEqual(
          {
            count: after.length,
            keepsFirst: before.every(link => after.includes(link)),
            newSocket: second !== '' && second !== first,
          },
          {count: 2, keepsFirst: true, newSocket: true},
          `${before.join(',')} -> ${after.join(',')}`,
        );
      } finally {
        await closeWindow('c99-reload').catch(() => undefined);
      }
    });
  });

  it('F-2311 AC-20 (c99-tmpdir): for an account whose login shell sets TMPDIR to a folder of its own, the link is still created in /tmp', async () => {
    await freshHost(TMPDIR_USER);
    await onHostAs('root', 'sh', '-c', `rm -f ${LINK_PATTERN}`);
    await windowWithTerminal('c99-tmpdir', TMPDIR_ALIAS, TMPDIR_USER);
    try {
      await connectedWithin('c99-tmpdir', INSTALL_MILLISECONDS, TMPDIR_USER);
      await waitFor(
        'the agent link',
        async () => (await hostLinks()).length > 0,
        10_000,
      ).catch(() => undefined);
      deepStrictEqual(
        {
          owners: (await hostLinks()).map(link => link.split(' ')[0]),
          inHomeTmp: (
            await onHostAs(
              TMPDIR_USER,
              'sh',
              '-c',
              `ls /home/${TMPDIR_USER}/tmp 2>/dev/null | grep vscode-ssh-auth-sock || true`,
            )
          ).trim(),
        },
        {owners: [TMPDIR_USER], inHomeTmp: ''},
      );
    } finally {
      await closeWindow('c99-tmpdir').catch(() => undefined);
    }
  });

  it('F-2311 AC-21 (c99-links-stay): the link of a window that closed is still in /tmp', async () => {
    await connectedOn(FORWARDING, 'c99-links-stay');
    const before = await hostLinks();
    await closeWindow('c99-links-stay');
    await noHelperWithin(60_000);
    deepStrictEqual(
      {before: before.length, after: await hostLinks()},
      {before: 1, after: before},
    );
  });
});
