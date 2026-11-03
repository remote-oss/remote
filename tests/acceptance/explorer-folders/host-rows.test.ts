/**
 * @fileoverview The host rows of the Remotes view (card coverage-102, part 3d): the context menu of a host row, what
 * its two actions open, and Enter on it in an SSH folder window.
 */

import {deepStrictEqual} from 'node:assert';
import {
  inWindow,
  isOpen,
  nextEmptyWindow,
  onHost,
  windowNames,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  rememberPage,
  rowAction,
  rowContextMenu,
  rowContextMenuByKey,
  viewRows,
  notifications,
  pressEnter,
  clickRowLabel,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  closeIfOpen,
  connectedTo,
  folderRowsOf,
  foldersSettled,
  HOME,
  openAddress,
  ownPathsOf,
  viewWindow,
  visit,
} from '../windows/explorer-folders.ts';

/** The host the rows open folders on. */
const HOST = 'harness';

const CURRENT = 'Connect in Current Window...';
const IN_NEW = 'Connect in New Window...';

/** The folders of the rows. */
const FIRST = `${HOME}/c5103-f1`;
const SCOPE = `${HOME}/c5103-`;

/** Opens the folder `name` of the account's home on the host in a window of its own and waits until it is connected; `name`. */
async function openFolder(name: string): Promise<string> {
  await onHost('mkdir', '-p', `${HOME}/${name}`);
  await openAddress(`vscode-remote://ssh-remote+${HOST}${HOME}/${name}`, name);
  await connectedTo(name, HOST);
  return name;
}

/** The label of a host row of window `window` that has no folder under it. */
async function hostWithoutFolders(window: string): Promise<string> {
  const rows = (await viewRows(window, VIEW)) ?? [];
  const idle = rows.find(
    (each, index) =>
      each.level === 2 &&
      each.label !== HOST &&
      (rows[index + 1]?.level ?? 0) <= 2,
  );
  if (idle === undefined) {
    throw new Error(`window ${window}: no host row without folders`);
  }
  return idle.label;
}

describe('the host rows of the view (card coverage-102, part 3d)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  it('F-5103 AC-2 (host-menu): the context menu of a host row, by a right click and by Shift+F10, holds the two connects and nothing else, for a row with folders, a connected row and a row with none', async () => {
    await visit(HOST, 'c5103-f1');
    const window = await viewWindow('c5103-menu');
    let connected = '';
    try {
      await foldersSettled(window, HOST, [FIRST], SCOPE);
      const idle = await hostWithoutFolders(window);
      const menus: Record<string, string[]> = {};
      menus.withFolders = await rowContextMenu(window, VIEW, HOST);
      menus.withFoldersByKey = await rowContextMenuByKey(window, VIEW, HOST);
      menus.none = await rowContextMenu(window, VIEW, idle);
      menus.noneByKey = await rowContextMenuByKey(window, VIEW, idle);
      connected = await openFolder('c5103conn');
      menus.connected = await rowContextMenu(window, VIEW, HOST);
      menus.connectedByKey = await rowContextMenuByKey(window, VIEW, HOST);
      const expected = [CURRENT, IN_NEW];
      deepStrictEqual(menus, {
        withFolders: expected,
        withFoldersByKey: expected,
        none: expected,
        noneByKey: expected,
        connected: expected,
        connectedByKey: expected,
      });
    } finally {
      await closeIfOpen(connected);
      await closeIfOpen(window);
    }
  });

  it('F-5103 AC-22 (host-actions): either action on a host row that has a recent folder opens the window with no folder and leaves the history as it was', async () => {
    await visit(HOST, 'c5103-f2');
    const issuer = await viewWindow('c5103-actions');
    let opened = '';
    try {
      await foldersSettled(issuer, HOST, [`${HOME}/c5103-f2`, FIRST], SCOPE);
      const history = await ownPathsOf(HOST, SCOPE);
      opened = await nextEmptyWindow(() =>
        rowAction(issuer, VIEW, HOST, IN_NEW),
      );
      await connectedTo(opened, HOST);
      const inNew = [
        (await windowState(opened)).folders,
        await ownPathsOf(HOST, SCOPE),
      ];
      await closeIfOpen(opened);
      opened = await nextEmptyWindow(() =>
        rowAction(issuer, VIEW, HOST, CURRENT),
      );
      await connectedTo(opened, HOST);
      deepStrictEqual(
        [
          inNew,
          (await windowState(opened)).folders,
          await ownPathsOf(HOST, SCOPE),
        ],
        [[[], history], [], history],
      );
    } finally {
      await closeIfOpen(opened);
      await closeIfOpen(issuer);
    }
  });

  it('F-5103 AC-27 (enter-toggles): in an SSH folder window, Enter on the focused host row collapses it and a second Enter expands it again, and neither opens, closes or reloads a window', async () => {
    await visit(HOST, 'c5103-f3');
    const name = await openFolder('c5103enter');
    try {
      await inWindow(name, 'workbench.view.remote');
      async function expanded(): Promise<boolean> {
        const rows = (await viewRows(name, VIEW)) ?? [];
        return rows.find(each => each.label === HOST)?.expanded === true;
      }
      await waitFor(
        `the host row of window ${name} to list its folders`,
        async () => (await folderRowsOf(name, HOST)).length > 0,
        30_000,
      );
      await clickRowLabel(name, VIEW, HOST);
      if (!(await expanded())) {
        await pressEnter(name);
      }
      const windows = windowNames().join(',');
      const states = [await expanded()];
      for (let presses = 0; presses < 2; presses += 1) {
        await pressEnter(name);
        await new Promise(resolve => setTimeout(resolve, 1500));
        states.push(await expanded());
      }
      deepStrictEqual(
        [
          states,
          windowNames().join(','),
          isOpen(name),
          (await windowState(name)).remoteAuthority,
          await notifications(name),
        ],
        [[true, false, true], windows, true, `ssh-remote+${HOST}`, []],
      );
    } finally {
      await closeIfOpen(name);
    }
  });
});
