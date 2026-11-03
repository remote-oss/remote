import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  readUserSettings,
  variable,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  allQuickPickRows,
  clickStatusItem,
  paletteRows,
  pressEscape,
  quickPickFacts,
  rowContextMenu,
} from '../windows/renderer.ts';
import {rowsWhen, VIEW} from '../windows/dev-containers-view.ts';
import {connectedWindow, removeContainersOf} from './support.ts';

const execFileAsync = promisify(execFile);

/** The four commands that reopen the folder elsewhere, by their ids. */
const REOPEN_COMMANDS = [
  'remote-containers.reopenLocally',
  'remote-containers.reopenInSSH',
  'remote-containers.reopenInWSL',
  'remote-containers.reopenInTunnel',
];

/** The labels of the four commands in the Command Palette. */
const PALETTE_LABELS = [
  'Dev Containers: Reopen Folder Locally',
  'Dev Containers: Reopen Folder in SSH',
  'Dev Containers: Reopen Folder in WSL',
  'Dev Containers: Reopen Folder in Tunnel',
];

/** The labels of the four commands in the remote indicator's menu and the row menus. */
const MENU_LABELS = [
  'Reopen Folder Locally',
  'Reopen Folder in SSH',
  'Reopen Folder in WSL',
  'Reopen Folder in Tunnel',
];

/** The labels of the rows of the remote indicator's menu in window `name`, once it is open; Escape closes it. */
async function indicatorMenu(name: string): Promise<string[]> {
  await clickStatusItem(name, 'status.host');
  await waitFor(
    `the remote indicator's menu in window ${name}`,
    async () => (await quickPickFacts(name)) !== undefined,
    15_000,
  );
  const labels = (await allQuickPickRows(name)).map(entry => entry.label);
  await pressEscape(name);
  await waitFor(
    `the menu of window ${name} to close`,
    async () => (await quickPickFacts(name)) === undefined,
    10_000,
  );
  return labels;
}

/** What Docker holds: the ids of its containers, images and volumes. */
async function dockerHoldings(): Promise<string[][]> {
  return Promise.all(
    [
      ['ps', '-aq', '--no-trunc'],
      ['images', '-aq', '--no-trunc'],
      ['volume', 'ls', '-q'],
    ].map(async argv => {
      const {stdout} = await execFileAsync('docker', argv);
      return stdout
        .split('\n')
        .filter(line => line !== '')
        .sort();
    }),
  );
}

/** The key and value of every item of the state databases of the launch's profile and workspaces that the extension owns. */
function ownedState(): Record<string, string> {
  const user = path.join(variable('HARNESS_USER_DATA'), 'User');
  const workspaces = path.join(user, 'workspaceStorage');
  const files = [
    path.join(user, 'globalStorage', 'state.vscdb'),
    ...(existsSync(workspaces)
      ? readdirSync(workspaces).map(folder =>
          path.join(workspaces, folder, 'state.vscdb'),
        )
      : []),
  ].filter(file => existsSync(file));
  const items: Record<string, string> = {};
  for (const file of files) {
    const database = new DatabaseSync(file, {readOnly: true});
    try {
      for (const entry of database
        .prepare('SELECT key, value FROM ItemTable')
        .all() as Array<{key: string; value: string}>) {
        if (/remote-containers|remote-oss\.remote-containers/.test(entry.key)) {
          items[`${path.basename(path.dirname(file))}/${entry.key}`] =
            entry.value;
        }
      }
    } finally {
      database.close();
    }
  }
  return items;
}

describe('Reopen Folder Locally: where it is listed (card coverage-103, F-0406)', function () {
  this.timeout(900_000);

  it('F-0406 AC-15, AC-18, F-0901 AC-5 (c103-listings): a local-Docker dev-container window lists only Reopen Folder Locally of the four in the palette, the indicator menu and the row menu, with the exact labels, and the row menu is exactly the six entries', async () => {
    const connected = await connectedWindow('c103-listings');
    try {
      const label = path.basename(connected.folder);
      await inWindow(connected.window, 'workbench.view.remote');
      await rowsWhen(connected.window, rows =>
        rows.some(each => each.label === label),
      );
      const palette = (
        await paletteRows(connected.window, 'Reopen Folder')
      ).filter(entry => PALETTE_LABELS.includes(entry));
      const indicator = (await indicatorMenu(connected.window)).filter(entry =>
        MENU_LABELS.includes(entry),
      );
      const menu = (await rowContextMenu(connected.window, VIEW, label)).filter(
        entry => entry !== '',
      );
      deepStrictEqual(
        [palette, indicator, menu],
        [
          ['Dev Containers: Reopen Folder Locally'],
          ['Reopen Folder Locally'],
          [
            'Show Details',
            'Inspect',
            'Show Container Log',
            'Close Workspace',
            'Reopen Folder Locally',
            'Rebuild Container',
          ],
        ],
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });

  it('F-0406 AC-33 (c103-local-keys): in a local window with a dev-container configuration, the four commands invoked with no argument create, change and remove no container, image or volume, write no setting, and leave the window open', async () => {
    const folder = devContainerFolder('c103-local-keys', {name: 'Local'});
    const window = await openFolderWindow(folder);
    try {
      const holdings = await dockerHoldings();
      const settings = readUserSettings();
      const windows = windowNames();
      for (const command of REOPEN_COMMANDS) {
        await inWindow(window, command).catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
      deepStrictEqual(
        [
          await dockerHoldings(),
          readUserSettings(),
          windowNames(),
          (await paletteRows(window, 'Reopen in Container')).length > 0,
        ],
        [holdings, settings, windows, true],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      mkdirSync(folder, {recursive: true});
    }
  });

  it('F-0406 AC-14 (c103-state): running Reopen Folder Locally changes no key of the extension’s own state beyond what a plain reload of the same window changes', async () => {
    const control = await connectedWindow('c103-state-control');
    let controlChange: string[] = [];
    try {
      const before = ownedState();
      await inWindow(control.window, 'workbench.action.reloadWindow').catch(
        () => undefined,
      );
      await new Promise(resolve => setTimeout(resolve, 15_000));
      controlChange = changedKeys(before, ownedState());
    } finally {
      await closeWindow(control.window).catch(() => undefined);
      await removeContainersOf(control.folder);
    }
    const connected = await connectedWindow('c103-state');
    try {
      const before = ownedState();
      await inWindow(connected.window, REOPEN_COMMANDS[0] ?? '').catch(
        () => undefined,
      );
      await new Promise(resolve => setTimeout(resolve, 15_000));
      deepStrictEqual(
        changedKeys(before, ownedState()).filter(
          key => !controlChange.includes(key),
        ),
        [],
        JSON.stringify(controlChange),
      );
    } finally {
      await closeWindow(connected.window).catch(() => undefined);
      await removeContainersOf(connected.folder);
    }
  });
});

/** The keys that are new in `after`, or whose value differs from `before`. */
function changedKeys(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  return Object.keys(after).filter(key => before[key] !== after[key]);
}
