/**
 * @fileoverview The reference Remote Explorer installed into a running window (card coverage-25e, #1348): the launch
 * starts with the stand-in carrying its id in the extensions folder, so each row takes the stand-in out of the folder's
 * `extensions.json` first, opens a window the explorer is active in, and writes the entry back, as the editor's CLI
 * does when it installs an extension into the folder.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  rowsOf,
  rowsSettled,
  STAND_DOWN_WARNING,
} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  hostAliases,
  inWindow,
  nextEmptyWindow,
  reloadingCommand,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  notificationCentre,
  rowAction,
  titleAction,
  viewRows,
} from '../windows/renderer.ts';

const VIEW = 'Remotes (Tunnels/SSH)';
const REFERENCE = 'ms-vscode.remote-explorer';

/** How long the row waits to be sure no warning comes. */
const QUIET_MILLISECONDS = 10_000;

/** Pauses for `milliseconds`. */
function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * How many of the window's notifications are the coexistence warning. They are read in the notification centre: a small
 * window, such as CI's, draws no toast for it.
 */
async function warnings(window: string): Promise<number> {
  return (await notificationCentre(window)).filter(
    text => text === STAND_DOWN_WARNING,
  ).length;
}

describe('the reference installed into a running window (card coverage-25e)', function () {
  this.timeout(300_000);

  it('F-5901 AC-8 (installed-while-running): installed into the running window the reference brings no warning and keeps the rows and their actions; after the extension host restarts there is one warning and no row or title action of ours', async () => {
    const listFile = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensions-explorer-standdown',
      'extensions.json',
    );
    const withStandIn = readFileSync(listFile, 'utf8');
    const entries = JSON.parse(withStandIn) as Array<{
      identifier: {id: string};
    }>;
    writeFileSync(
      listFile,
      JSON.stringify(
        entries.filter(entry => entry.identifier.id !== REFERENCE),
      ),
    );
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'late-install');
    mkdirSync(folder, {recursive: true});
    let window = '';
    let connected = '';
    try {
      window = await openFolderWindow(folder);
      await inWindow(window, 'workbench.view.remote');
      await rowsSettled(window, rowsOf(hostAliases(), undefined));
      writeFileSync(listFile, withStandIn);
      await pause(QUIET_MILLISECONDS);
      const warnedWhileRunning = await warnings(window);
      await titleAction(window, VIEW, 'Refresh');
      await rowsSettled(window, rowsOf(hostAliases(), undefined));
      connected = await nextEmptyWindow(() =>
        rowAction(window, VIEW, 'harness', 'Connect in New Window...'),
      );
      await waitFor(
        `window ${connected} to connect to harness`,
        async () =>
          (await windowState(connected)).remoteAuthority ===
          'ssh-remote+harness',
        120_000,
      );
      await reloadingCommand(window, 'workbench.action.restartExtensionHost');
      await inWindow(window, 'remoteTargets.focus');
      await waitFor(
        `the coexistence warning in window ${window}`,
        async () => (await warnings(window)) > 0,
        30_000,
      );
      await pause(QUIET_MILLISECONDS);
      let refreshError: unknown;
      try {
        await inWindow(window, 'remote-explorer.refresh');
      } catch (caught) {
        refreshError = caught;
      }
      deepStrictEqual(
        {
          warnedWhileRunning,
          warningsAfterRestart: await warnings(window),
          sshRows: ((await viewRows(window, VIEW)) ?? []).filter(
            viewRow => viewRow.label === 'SSH',
          ),
          refreshNotFound:
            refreshError instanceof Error &&
            refreshError.message.includes('not found'),
        },
        {
          warnedWhileRunning: 0,
          warningsAfterRestart: 1,
          sshRows: [],
          refreshNotFound: true,
        },
      );
    } finally {
      writeFileSync(listFile, withStandIn);
      for (const each of [connected, window]) {
        if (each !== '') {
          await closeWindow(each);
        }
      }
    }
  });
});
