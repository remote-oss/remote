/**
 * @fileoverview F-2311 AC-23 and AC-26 (card coverage-99): an account that may not create links in the system temp
 * folder, on the Ubuntu 26.04 host, which an ACL entry on /tmp keeps from it.
 */

import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  agentAdd,
  closeWindow,
  connectedWithin,
  fingerprintOf,
  inWindow,
  onHostAs,
  recordLines,
  reloadWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hostLinks, LINK_PATTERN} from '../windows/agent-links.ts';
import {freshHost, INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {statusBarItemIds} from '../windows/renderer.ts';
import {listedKeys, windowWithTerminal} from '../windows/terminal-support.ts';

/** The account that may not create links in /tmp, and the alias that forwards the run's agent to it. */
const USER = 'harness-notmp';
const ALIAS = 'agentfwd-notmp';

/** What `ssh-add -l` prints when the socket named by SSH_AUTH_SOCK does not exist, spaces written as underscores. */
const NO_SOCKET = 'Error_connecting_to_agent:_No_such_file_or_directory';

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

/** The status bar items window `name` shows, once it has had a moment to settle. */
async function barItems(name: string): Promise<string[]> {
  await new Promise(resolve => setTimeout(resolve, 3000));
  return statusBarItemIds(name);
}

/** The sockets sshd has forwarded for the account, the paths of its agent folder. */
async function forwardedSockets(): Promise<string[]> {
  const listed = await onHostAs(
    USER,
    'sh',
    '-c',
    `for socket in /home/${USER}/.ssh/agent/*; do [ -S "$socket" ] && echo "$socket"; done; true`,
  );
  return listed.split('\n').filter(line => line !== '');
}

/** Opens window `name` on the account's alias on a host with no server, with a terminal, and waits for the connect. */
async function connectedWindow(name: string): Promise<void> {
  await agentAdd(keyFile(), {confirm: false});
  await freshHost(USER);
  await onHostAs('root', 'sh', '-c', `rm -f ${LINK_PATTERN}`);
  await windowWithTerminal(name, ALIAS, USER);
  await connectedWithin(name, INSTALL_MILLISECONDS, USER);
}

describe('F-2311, an account that may not create links in /tmp (card coverage-99)', function () {
  this.timeout(300_000);

  after(async () => {
    await onHostAs('root', 'setfacl', '-m', `u:${USER}:r-x`, '/tmp');
    await freshHost(USER);
  });

  it('F-2311 AC-23 (c99-notmp): with the link refused, the connect completes, nothing is shown (no notification, dialog, input, pick or status item beyond a plain window’s), and a new terminal’s ssh-add -l prints that the socket does not exist', async () => {
    await connectedWindow('c99-notmp');
    try {
      const items = await barItems('c99-notmp');
      await windowWithTerminal('c99-notmp-base', 'harness');
      await connectedWithin('c99-notmp-base', INSTALL_MILLISECONDS);
      const baseline = await barItems('c99-notmp-base');
      await closeWindow('c99-notmp-base');
      deepStrictEqual(
        {
          extraItems: items.filter(item => !baseline.includes(item)),
          links: await hostLinks(),
          shown: recordLines(undefined, 'c99-notmp')
            .map(line => line.surface)
            .filter(surface => SHOWN_SURFACES.includes(surface)),
          listed: await listedKeys('c99-notmp'),
        },
        {extraItems: [], links: [], shown: [], listed: NO_SOCKET},
      );
    } finally {
      await closeWindow('c99-notmp').catch(() => undefined);
    }
  });

  it('F-2311 AC-26 (c99-notmp-back): once /tmp is writable again, a reload with the local server running makes a link to the same forwarded socket, and a new terminal lists the keys', async () => {
    await connectedWindow('c99-notmp-back');
    try {
      const forwarded = await forwardedSockets();
      await onHostAs('root', 'setfacl', '-x', `u:${USER}`, '/tmp');
      await reloadWindow('c99-notmp-back');
      await connectedWithin('c99-notmp-back', INSTALL_MILLISECONDS, USER);
      await waitFor(
        'the agent link',
        async () => (await hostLinks()).length > 0,
        30_000,
      ).catch(() => undefined);
      const links = await hostLinks();
      const target = (
        await onHostAs(USER, 'readlink', links[0]?.split(' ')[1] ?? '').catch(
          () => '',
        )
      ).trim();
      await inWindow('c99-notmp-back', 'workbench.action.terminal.new');
      deepStrictEqual(
        {
          count: links.length,
          sameSocket: forwarded.length === 1 && target === forwarded[0],
          listsKey: (await listedKeys('c99-notmp-back')).includes(
            await fingerprintOf(keyFile()),
          ),
        },
        {count: 1, sameSocket: true, listsKey: true},
        `${links.join(',')} -> ${target} (forwarded ${forwarded.join(',')})`,
      );
    } finally {
      await closeWindow('c99-notmp-back').catch(() => undefined);
    }
  });
});
