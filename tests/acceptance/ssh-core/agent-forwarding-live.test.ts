/**
 * @fileoverview F-2311 (card coverage-99, part 5): the agent forwarding of a window whose server was started by an
 * earlier connection, and of windows that follow one another on a host.
 */

import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  agentAdd,
  appendScript,
  closeWindow,
  connectedWithin,
  fingerprintOf,
  hostAnswer,
  inWindow,
  kill,
  noHelperWithin,
  reloadWindow,
  userSettings,
  onHost,
  recordLines,
  runShellTask,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {freshHost, INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  listedKeys,
  printedAfter,
  windowWithTerminal,
} from '../windows/terminal-support.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';
import {terminalText} from '../windows/renderer.ts';
import {
  extensionHostSockets,
  hostLinks,
  LINK_PATTERN,
} from '../windows/agent-links.ts';

/** The alias that forwards the run's agent, and the one that does not. */
const FORWARDING = 'agentfwd';
const PLAIN = 'harness';

/** The surfaces that would show the user something. */
const SHOWN_SURFACES = [
  'notice',
  'failureDialog',
  'inputBox',
  'hostPick',
  'mitigationPick',
];

/** The key of the run that the agent holds. */
function keyFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'id_second');
}

describe('F-2311, agent forwarding into a server that is already running (card coverage-99, part 5)', function () {
  this.timeout(300_000);

  after(async () => {
    await freshHost();
  });

  it('F-2311 AC-13 (c99-old-server): a window with ForwardAgent yes on a server started by a connection without it gives terminals, tasks and the extension host the link to the agent', async () => {
    await agentAdd(keyFile(), {confirm: false});
    await freshHost();
    await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    await windowWithTerminal('c99-old-first', PLAIN);
    await connectedWithin('c99-old-first', INSTALL_MILLISECONDS);
    await closeWindow('c99-old-first');
    await noHelperWithin(60_000);
    await windowWithTerminal('c99-old', FORWARDING);
    try {
      await connectedWithin('c99-old', INSTALL_MILLISECONDS);
      const fingerprint = await fingerprintOf(keyFile());
      const terminalKeys = await listedKeys('c99-old').catch(
        async (caught: unknown) =>
          `${String(caught)} ${(await terminalText('c99-old')).slice(-400)}`,
      );
      const written = '/home/harness/c99-old.txt';
      await onHost('rm', '-f', written);
      const exit = await runShellTask(
        'c99-old',
        `{ echo "$SSH_AUTH_SOCK"; ssh-add -l; } > ${written} 2>&1`,
      );
      const [taskSocket = '', ...taskKeys] = (await onHost('cat', written))
        .trim()
        .split('\n');
      const links = await hostLinks();
      deepStrictEqual(
        {
          terminal: terminalKeys.includes(fingerprint),
          task: [exit, taskKeys.join('\n').includes(fingerprint)],
          taskIsLink: links.some(link => link.endsWith(` ${taskSocket}`)),
          extensionHostIsLink: (await extensionHostSockets()).every(socket =>
            links.some(link => link.endsWith(` ${socket}`)),
          ),
        },
        {
          terminal: true,
          task: [0, true],
          taskIsLink: true,
          extensionHostIsLink: true,
        },
        JSON.stringify({
          links,
          hosts: await extensionHostSockets(),
          terminalKeys,
        }),
      );
    } finally {
      await closeWindow('c99-old').catch(() => undefined);
    }
  });

  /** The link names of the host's agent links with the socket each points to, as `<path> -> <socket>`. */
  async function linkTargets(): Promise<string[]> {
    return Promise.all(
      (await hostLinks()).map(async link => {
        const linkPath = link.split(' ')[1] ?? '';
        return `${linkPath} -> ${(await onHost('readlink', linkPath).catch(() => '')).trim()}`;
      }),
    );
  }

  it('F-2311 AC-16 (c99-reconnect): when the connection comes back after the local server was killed the link keeps its name and points at the new session’s socket, and the old terminal still lists the keys', async () => {
    await agentAdd(keyFile(), {confirm: false});
    await freshHost();
    await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    await windowWithTerminal('c99-back', FORWARDING);
    try {
      await connectedWithin('c99-back', INSTALL_MILLISECONDS);
      const before = await linkTargets();
      appendScript([hostAnswer('c99-back', {label: FORWARDING})]);
      await kill('c99-back');
      await waitFor(
        'the window to be connected again',
        async () => {
          const targets = await linkTargets();
          return (
            targets.length === 1 &&
            targets[0] !== before[0] &&
            (await windowState('c99-back').catch(() => undefined))
              ?.remoteName === 'ssh-remote'
          );
        },
        INSTALL_MILLISECONDS,
      ).catch(() => undefined);
      const after = await linkTargets();
      deepStrictEqual(
        {
          sameName: after.map(entry => entry.split(' -> ')[0]),
          newSocket: after[0]?.split(' -> ')[1] !== before[0]?.split(' -> ')[1],
          keysInOldTerminal: (await listedKeys('c99-back')).includes(
            await fingerprintOf(keyFile()),
          ),
        },
        {
          sameName: before.map(entry => entry.split(' -> ')[0]),
          newSocket: true,
          keysInOldTerminal: true,
        },
        `${before.join(',')} => ${after.join(',')}`,
      );
    } finally {
      await closeWindow('c99-back').catch(() => undefined);
    }
  });

  /** What a new terminal of `name` prints for SSH_AUTH_SOCK, and whether `ssh-add -l` there lists the key. */
  async function socketSeen(name: string): Promise<string> {
    await inWindow(name, 'workbench.action.terminal.new');
    return printedAfter(name, 'SOCK', '$SSH_AUTH_SOCK');
  }

  /**
   * Connects a window with the setting `atConnect` on a fresh host, changes the setting, and gives what new terminals
   * print for SSH_AUTH_SOCK and what the host holds after the change, after a reload with the local server running, and
   * after Kill Local Connection Server and the reconnect, with the keys the last terminal lists.
   */
  async function afterChange(
    name: string,
    atConnect: boolean,
  ): Promise<{
    steps: Array<{step: string; socket: string; links: string[]}>;
    keys: string;
    shown: string[];
  }> {
    await agentAdd(keyFile(), {confirm: false});
    await userSettings({'remote.SSH.enableAgentForwarding': atConnect});
    await freshHost();
    await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    await windowWithTerminal(name, FORWARDING);
    const steps: Array<{step: string; socket: string; links: string[]}> = [];
    async function note(step: string): Promise<void> {
      steps.push({
        step,
        socket: await socketSeen(name),
        links: await hostLinks(),
      });
    }
    try {
      await connectedWithin(name, INSTALL_MILLISECONDS);
      await note('connect');
      await userSettings({'remote.SSH.enableAgentForwarding': !atConnect});
      await new Promise(resolve => setTimeout(resolve, 3000));
      await note('changed');
      await reloadWindow(name);
      await connectedWithin(name, INSTALL_MILLISECONDS);
      await note('reload');
      // The pick of the kill below is the row's own: what the setting's change showed is read before it.
      const shown = recordLines(undefined, name)
        .map(line => line.surface)
        .filter(surface => SHOWN_SURFACES.includes(surface));
      appendScript([hostAnswer(name, {label: FORWARDING})]);
      await kill(name);
      await waitFor(
        'the window to be connected again',
        async () =>
          (await windowState(name).catch(() => undefined))?.remoteName ===
          'ssh-remote',
        INSTALL_MILLISECONDS,
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
      await note('killed');
      return {
        steps,
        keys: await listedKeys(name),
        shown,
      };
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  }

  /** Whether a path is one of the extension's agent links. */
  function isLink(socket: string): boolean {
    return /^\/tmp\/vscode-ssh-auth-sock-\d+$/.test(socket);
  }

  it('F-2311 AC-18 (c99-setting-to-true): with the setting false at connect and then true, nothing is shown and new terminals keep the session socket, also after a reload with the local server running; after Kill Local Connection Server and the reconnect they get a link and list the keys', async () => {
    await keepingSettings(async () => {
      const result = await afterChange('c99-to-true', false);
      const [connect, changed, reload, killed] = result.steps;
      deepStrictEqual(
        {
          noLinkBefore: [connect, changed, reload].map(
            entry => entry?.links.length,
          ),
          keptSocket: [changed?.socket, reload?.socket].map(
            socket => socket === connect?.socket,
          ),
          sessionSocket: isLink(connect?.socket ?? ''),
          afterKill: [isLink(killed?.socket ?? ''), killed?.links.length],
          keys: result.keys.includes(await fingerprintOf(keyFile())),
          shown: result.shown,
        },
        {
          noLinkBefore: [0, 0, 0],
          keptSocket: [true, true],
          sessionSocket: false,
          afterKill: [true, 1],
          keys: true,
          shown: [],
        },
        JSON.stringify(result.steps),
      );
    });
  });

  it('F-2311 AC-18 (c99-setting-to-false): with the setting true at connect and then false, nothing is shown and new terminals keep the link, also after a reload with the local server running; after Kill Local Connection Server and the reconnect the decision is made again with false, so they get the session socket and the old link stays', async () => {
    await keepingSettings(async () => {
      const result = await afterChange('c99-to-false', true);
      const [connect, changed, reload, killed] = result.steps;
      deepStrictEqual(
        {
          link: isLink(connect?.socket ?? ''),
          keptLink: [changed?.socket, reload?.socket].map(
            socket => socket === connect?.socket,
          ),
          afterKill: [
            isLink(killed?.socket ?? ''),
            killed?.links.length,
            killed?.links[0] === connect?.links[0],
          ],
          keys: result.keys,
          shown: result.shown,
        },
        {
          link: true,
          keptLink: [true, true],
          afterKill: [false, 1, true],
          keys: 'Error_connecting_to_agent:_No_such_file_or_directory',
          shown: [],
        },
        JSON.stringify(result.steps),
      );
    });
  });
});
