/**
 * @fileoverview The increment-2 gate, rows 1 to 4 (card coverage-102, #1809, part 3g; brief-explorer-increment-2 §7):
 * the recent folders and workspaces of a host as the view lists, sorts, collapses, opens and removes them (the history
 * feature's BR-1, BR-3, BR-5, BR-7, BR-13 and BR-15).
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  onHost,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {activations} from '../windows/folder-windows.ts';
import {
  rememberPage,
  rowAction,
  rowMenuAction,
  titleAction,
  viewRows,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';
import {
  appearsAfter,
  closeIfOpen,
  connectedTo,
  folderRowsOf,
  foldersSettled,
  HOME,
  openAddress,
  pathsOf,
  viewWindow,
  visit,
} from '../windows/explorer-folders.ts';

const HOST = 'harness';
const CURRENT = 'Connect in Current Window...';
const IN_NEW = 'Connect in New Window...';
const REMOVE = 'Remove from Recent List';

/** The settings of the explorer that rows 2 changes. */
const SORT_ORDER = 'remote-explorer.foldersSortOrder';
const COLLAPSE = 'remote-explorer.collapseRecentFolders';

/** Opens the workspace file `file` of folder `folder` on the host in a window of its own, and waits until it is recorded. */
async function visitWorkspace(folder: string, name: string): Promise<string> {
  const file = `${folder}/${name}.code-workspace`;
  await onHost('mkdir', '-p', folder);
  await onHost(
    'sh',
    '-c',
    `printf '%s' '{"folders":[{"path":"."}]}' > ${file}`,
  );
  // A remote workspace window has no folders when its agent starts, so it is named after the workspace file's folder.
  const window = folder.slice(folder.lastIndexOf('/') + 1);
  await openAddress(`vscode-remote://ssh-remote+${HOST}${file}`, window);
  await connectedTo(window, HOST);
  await waitFor(
    `the history of ${HOST} to start with ${file}`,
    async () => (await pathsOf(HOST))[0] === file,
    30_000,
  );
  await closeWindow(window);
  return file;
}

describe('the increment-2 gate: recent folders and workspaces (card coverage-102, part 3g)', function () {
  this.timeout(900_000);
  let savedSettings: string | undefined;

  before(() => rememberPage('local'));

  beforeEach(() => {
    savedSettings = readUserSettings();
  });

  afterEach(() => {
    restoreUserSettings(savedSettings);
  });

  it('F-5902 AC-10 (gate-1): after connecting to the host on a folder and then on a workspace file, its row lists both, most recent first, in a second window after Refresh', async () => {
    const scope = `${HOME}/c102g1-`;
    const folder = `${HOME}/c102g1-folder`;
    const view = await viewWindow('c102g1-view');
    try {
      await visit(HOST, 'c102g1-folder');
      const file = await visitWorkspace(`${HOME}/c102g1-space`, 'g1');
      await titleAction(view, VIEW, 'Refresh');
      await foldersSettled(view, HOST, [file, folder], scope);
      deepStrictEqual(
        (await folderRowsOf(view, HOST))
          .filter(entry => entry.description.startsWith(scope))
          .map(entry => entry.label),
        ['g1 (Workspace)', 'c102g1-folder'],
      );
    } finally {
      await closeIfOpen(view);
    }
  });

  it('Gate row 2 (sort-and-collapse): with the sort order alphabetical and Refresh the rows sort by code unit, and with collapseRecentFolders on a window that draws the view starts every host row collapsed', async () => {
    const scope = `${HOME}/c102g2-`;
    const view = await viewWindow('c102g2-view');
    try {
      await visit(HOST, 'c102g2-a');
      await visit(HOST, 'c102g2-C');
      await visit(HOST, 'c102g2-b');
      await titleAction(view, VIEW, 'Refresh');
      await foldersSettled(
        view,
        HOST,
        [`${scope}b`, `${scope}C`, `${scope}a`],
        scope,
      );
      await userSettings({[SORT_ORDER]: 'alphabetical'});
      await titleAction(view, VIEW, 'Refresh');
      await foldersSettled(
        view,
        HOST,
        [`${scope}C`, `${scope}a`, `${scope}b`],
        scope,
      );
      await userSettings({[SORT_ORDER]: 'mru', [COLLAPSE]: true});
      const second = await viewWindow('c102g2-second');
      try {
        await new Promise(resolve => setTimeout(resolve, 5_000));
        const hosts = ((await viewRows(second, VIEW)) ?? []).filter(
          entry => entry.level === 2,
        );
        deepStrictEqual(
          [
            hosts.find(entry => entry.label === HOST)?.expanded,
            hosts.filter(entry => entry.expanded === true).length,
          ],
          [false, 0],
        );
      } finally {
        await closeIfOpen(second);
      }
    } finally {
      await closeIfOpen(view);
    }
  });

  it('Gate row 3 (connect-rows): Connect in New Window on a folder row opens that folder on the host in a new window, and Connect in Current Window on the workspace row opens the workspace', async () => {
    const view = await viewWindow('c102g3-view');
    let folderWindow = '';
    try {
      await visit(HOST, 'c102g3-folder');
      const file = await visitWorkspace(`${HOME}/c102g3-space`, 'g3');
      await titleAction(view, VIEW, 'Refresh');
      await foldersSettled(
        view,
        HOST,
        [file, `${HOME}/c102g3-folder`],
        `${HOME}/c102g3-`,
      );
      folderWindow = 'c102g3-folder';
      let before = activations(folderWindow);
      await rowAction(view, VIEW, 'c102g3-folder', IN_NEW);
      await appearsAfter(folderWindow, before);
      await connectedTo(folderWindow, HOST);
      const opened = await windowState(folderWindow);
      await closeIfOpen(folderWindow);
      folderWindow = '';
      const workspaceWindow = 'c102g3-space';
      before = activations(workspaceWindow);
      await rowAction(view, VIEW, 'g3 (Workspace)', CURRENT);
      await appearsAfter(workspaceWindow, before);
      await connectedTo(workspaceWindow, HOST);
      const workspace = await windowState(workspaceWindow);
      await closeIfOpen(workspaceWindow);
      deepStrictEqual(
        [
          opened.remoteAuthority,
          opened.folders,
          workspace.remoteAuthority,
          workspace.workspaceFile?.endsWith(file),
        ],
        [
          `ssh-remote+${HOST}`,
          [`vscode-remote://ssh-remote%2B${HOST}${HOME}/c102g3-folder`],
          `ssh-remote+${HOST}`,
          true,
        ],
      );
    } finally {
      await closeIfOpen(folderWindow);
      await closeIfOpen(view);
    }
  });

  it('Gate row 4 (remove-row): Remove from Recent List removes the row at once, and after a reload it is still gone', async () => {
    const scope = `${HOME}/c102g4-`;
    const view = await viewWindow('c102g4-view');
    try {
      await visit(HOST, 'c102g4-keep');
      await visit(HOST, 'c102g4-gone');
      await titleAction(view, VIEW, 'Refresh');
      await foldersSettled(view, HOST, [`${scope}gone`, `${scope}keep`], scope);
      await rowMenuAction(view, VIEW, 'c102g4-gone', REMOVE);
      await foldersSettled(view, HOST, [`${scope}keep`], scope);
      await reloadWindow(view);
      await titleAction(view, VIEW, 'Refresh');
      await foldersSettled(view, HOST, [`${scope}keep`], scope);
      deepStrictEqual(
        (await pathsOf(HOST)).filter(entry => entry.startsWith(scope)),
        [`${scope}keep`],
      );
    } finally {
      await closeIfOpen(view);
    }
  });
});
