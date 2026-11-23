/**
 * @fileoverview F-2311 AC-22 (card coverage-99): what a window's terminals do about the agent link when the window
 * comes back. A shell the pty host reattaches after a reload keeps the link it started with, and Relaunch Terminal
 * gives it the new one; a window closed and opened again starts new shells, which get the new link at once (BR-10).
 * Core draws its mark on a terminal, or relaunches one that has had no input, only when the window's environment
 * collection reaches it after the terminal was made, which depends on timing; the rows leave the mark to core (#1686).
 */

import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  agentAdd,
  closeWindow,
  connectedWithin,
  fingerprintOf,
  inWindow,
  noHelperWithin,
  onHost,
  openWindow,
  reloadWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {freshHost, INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  listedKeys,
  printedAfter,
  windowWithTerminal,
} from '../windows/terminal-support.ts';
import {markedTerminalTabs} from '../windows/renderer.ts';
import {hostLinks, LINK_PATTERN} from '../windows/agent-links.ts';

/** The alias that forwards the run's agent. */
const FORWARDING = 'agentfwd';

/** The key of the run that the agent holds. */
function keyFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'id_second');
}

/** The paths of the agent links of the host now. */
async function linkPaths(): Promise<string[]> {
  return (await hostLinks()).map(link => link.split(' ')[1] ?? '');
}

describe('F-2311, the terminals of a window that comes back (card coverage-99)', function () {
  this.timeout(300_000);

  after(async () => {
    await freshHost();
  });

  it('F-2311 AC-22 (reading-1686-ac22-new-shell): a window closed and opened again on the same folder starts a new shell, which has the new window’s link at once', async () => {
    await agentAdd(keyFile(), {confirm: false});
    await freshHost();
    await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    await windowWithTerminal('c99-new-shell', FORWARDING);
    try {
      await connectedWithin('c99-new-shell', INSTALL_MILLISECONDS);
      const first = await printedAfter(
        'c99-new-shell',
        'SOCK',
        '$SSH_AUTH_SOCK',
      );
      await closeWindow('c99-new-shell');
      await noHelperWithin(60_000);
      await openWindow(FORWARDING, 'c99-new-shell');
      await connectedWithin('c99-new-shell', INSTALL_MILLISECONDS);
      await waitFor(
        'the second link',
        async () => (await linkPaths()).length > 1,
        10_000,
      ).catch(() => undefined);
      await inWindow('c99-new-shell', 'workbench.action.terminal.focus');
      await new Promise(resolve => setTimeout(resolve, 3000));
      const links = await linkPaths();
      const second = links.find(link => link !== first) ?? '';
      deepStrictEqual(
        {
          links: links.length,
          now: await printedAfter('c99-new-shell', 'NEW', '$SSH_AUTH_SOCK'),
        },
        {links: 2, now: second},
        `first link ${first}; marked tabs: ${JSON.stringify(await markedTerminalTabs('c99-new-shell'))}`,
      );
    } finally {
      await closeWindow('c99-new-shell').catch(() => undefined);
    }
  });

  it('F-2311 AC-22 (c99-reattached): after a reload with the local server running the reattached shell keeps the earlier link, and after Relaunch Terminal it has the new link and lists the keys', async function () {
    await agentAdd(keyFile(), {confirm: false});
    await freshHost();
    await onHost('sh', '-c', `rm -f ${LINK_PATTERN}`);
    await windowWithTerminal('c99-reattached', FORWARDING);
    try {
      await connectedWithin('c99-reattached', INSTALL_MILLISECONDS);
      const first = await printedAfter(
        'c99-reattached',
        'SOCK',
        '$SSH_AUTH_SOCK',
      );
      await reloadWindow('c99-reattached');
      await connectedWithin('c99-reattached', INSTALL_MILLISECONDS);
      await inWindow('c99-reattached', 'workbench.action.terminal.focus');
      await waitFor(
        'the second link',
        async () => (await linkPaths()).length > 1,
        30_000,
      ).catch(() => undefined);
      const links = await linkPaths();
      const second = links.find(link => link !== first) ?? '';
      const marks = await markedTerminalTabs('c99-reattached');
      const before = await printedAfter(
        'c99-reattached',
        'OLD',
        '$SSH_AUTH_SOCK',
      );
      if (before === second) {
        // Core relaunched the shell itself: the window's collection reached it before any input, so there is no
        // reattached shell with the earlier link left to observe in this run.
        this.skip();
      }
      await inWindow('c99-reattached', 'workbench.action.terminal.relaunch');
      await new Promise(resolve => setTimeout(resolve, 5000));
      const after = await printedAfter(
        'c99-reattached',
        'NEW',
        '$SSH_AUTH_SOCK',
      );
      deepStrictEqual(
        {
          links: links.length,
          before,
          after,
          keys: (await listedKeys('c99-reattached')).includes(
            await fingerprintOf(keyFile()),
          ),
        },
        {
          links: 2,
          before: first,
          after: second,
          keys: true,
        },
        `marked tabs after the reload: ${JSON.stringify(marks)}`,
      );
    } finally {
      await closeWindow('c99-reattached').catch(() => undefined);
    }
  });
});
