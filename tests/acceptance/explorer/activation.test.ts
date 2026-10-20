/**
 * @fileoverview When the explorer activates, and what it leaves behind (card coverage-25c, part b): a fresh window,
 * the view shown, a command run by its id, a reload with the view in front, and the folders, state keys and output
 * channels of the profile afterwards. Each row opens a window of its own, so the gate rows' windows don't count.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  commandsOf,
  extensionActive,
  hostAliases,
  inWindow,
  reloadWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {notifications, viewRows} from '../windows/renderer.ts';
import {rowsOf, rowsSettled, VIEW} from '../windows/explorer-rows.ts';

const EXPLORER = 'remote-oss.remote-explorer';
const SSH_COMPANION = 'remote-oss.remote-ssh';

/** Core's "View: Show Remote Explorer". */
const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';

/** How long a window stays open untouched before a row asks whether the explorer activated. */
const UNTOUCHED_MILLISECONDS = 30_000;

/** The hosts of the run's ssh_config. */
const HOSTS = hostAliases();

/** A new local window on a folder of the run named `name`, made first. */
function folderWindow(name: string): Promise<string> {
  const folder = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'explorer-rows',
    name,
  );
  mkdirSync(folder, {recursive: true});
  return openFolderWindow(folder);
}

function untouched(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, UNTOUCHED_MILLISECONDS));
}

/** The folders of `folder` whose name says they are the explorer's, at any depth. */
function explorerFolders(folder: string): string[] {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, {recursive: true, encoding: 'utf8'}).filter(
    entry => path.basename(entry).includes('remote-explorer'),
  );
}

/** The keys of the profile's global state database that name the explorer. */
function explorerStateKeys(userData: string): string[] {
  const database = path.join(userData, 'User', 'globalStorage', 'state.vscdb');
  if (!existsSync(database)) {
    return [];
  }
  const opened = new DatabaseSync(database, {readOnly: true});
  try {
    return opened
      .prepare("SELECT key FROM ItemTable WHERE key LIKE '%remote-explorer%'")
      .all()
      .map(entry => String(entry.key));
  } finally {
    opened.close();
  }
}

describe('when the explorer activates, and what it leaves (card coverage-25c, part b)', function () {
  this.timeout(240_000);

  it('F-5001 AC-1, AC-2, F-5101 AC-3, F-5901 AC-6, F-5902 AC-30 (fresh-window): a fresh folder window leaves the explorer and the SSH companion inactive for 30 s, and showing the Remote Explorer activates it with the SSH group and its hosts within 5 s and no notification', async () => {
    const name = await folderWindow('activation-fresh');
    try {
      await untouched();
      const before = [
        await extensionActive(name, EXPLORER),
        await extensionActive(name, SSH_COMPANION),
        await notifications(name),
      ];
      const shown = Date.now();
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await rowsSettled(name, rowsOf(HOSTS, undefined));
      deepStrictEqual(
        [
          before,
          Date.now() - shown <= 5_000,
          await extensionActive(name, EXPLORER),
          await notifications(name),
        ],
        [[false, false, []], true, true, []],
      );
    } finally {
      await closeWindow(name);
    }
  });

  it('F-5001 AC-4, F-5002 AC-5 (by-command): Refresh run by its id before the view was ever shown activates the explorer with no notification and leaves the side bar as it was, and the view then shows the hosts', async () => {
    const name = await folderWindow('activation-command');
    try {
      await inWindow(name, 'remote-explorer.refresh');
      await waitFor(
        `the explorer to activate in window ${name}`,
        () => extensionActive(name, EXPLORER),
        10_000,
      );
      const afterCommand = [
        await notifications(name),
        (await viewRows(name, VIEW)) === undefined,
      ];
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await rowsSettled(name, rowsOf(HOSTS, undefined));
      await inWindow(name, 'remote-explorer.refresh');
      deepStrictEqual(
        [afterCommand, await notifications(name)],
        [[[], true], []],
      );
    } finally {
      await closeWindow(name);
    }
  });

  it("F-5001 AC-25 (details-editor): opening the explorer's details editor in a fresh window does not activate it", async () => {
    const name = await folderWindow('activation-details');
    try {
      await inWindow(name, 'extension.open', EXPLORER);
      await new Promise(resolve => setTimeout(resolve, 5_000));
      deepStrictEqual(await extensionActive(name, EXPLORER), false);
    } finally {
      await closeWindow(name);
    }
  });

  it('F-5001 AC-14, F-5101 AC-36 (reload): with the Remote Explorer in front, Reload Window brings it back, activated with its rows, without user action', async () => {
    const name = await folderWindow('activation-reload');
    try {
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await rowsSettled(name, rowsOf(HOSTS, undefined));
      await reloadWindow(name);
      await rowsSettled(name, rowsOf(HOSTS, undefined));
      deepStrictEqual(await extensionActive(name, EXPLORER), true);
    } finally {
      await closeWindow(name);
    }
  });

  it('F-5001 AC-13, F-5101 AC-23, F-5102 AC-29, F-5103 AC-21, F-5901 AC-18 (nothing-left): after the view was shown, refreshed and its connects used, the profile holds no folder, log folder, state key or output channel of the explorer', async () => {
    const userData = path.join(variable('HARNESS_RUN_FOLDER'), 'user-data');
    const name = await folderWindow('activation-traces');
    try {
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await rowsSettled(name, rowsOf(HOSTS, undefined));
      await inWindow(name, 'remote-explorer.refresh');
      deepStrictEqual(
        [
          explorerFolders(path.join(userData, 'User', 'globalStorage')),
          explorerFolders(path.join(userData, 'logs')),
          explorerStateKeys(userData),
          await commandsOf(
            name,
            'workbench.action.output.show.extension-output-remote-oss.remote-explorer',
          ),
        ],
        [[], [], [], []],
      );
    } finally {
      await closeWindow(name);
    }
  });
});
