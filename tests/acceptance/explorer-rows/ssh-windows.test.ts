/**
 * @fileoverview The view in SSH windows, and its two connect actions from local, SSH and failed windows (card
 * coverage-25c, part b). Each row opens windows of its own; the windows a connect opens are found as the next empty
 * windows of the run.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  hostAliases,
  inWindow,
  isOpen,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  nextEmptyWindow,
  onHost,
  openWindow,
  recordLines,
  reloadingCommand,
  userSettingsFile,
  variable,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  extensionContextMenu,
  extensionsViewSections,
  notifications,
  rememberPage,
  renderedRows,
  type RenderedRow,
  rowAction,
  rowDetails,
  statusItem,
  titleAction,
} from '../windows/renderer.ts';
import {
  nothingFails,
  rowsOf,
  rowsSettled,
  VIEW,
} from '../windows/explorer-rows.ts';

const IN_NEW = 'Connect in New Window...';
const CURRENT = 'Connect in Current Window...';
const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';

/** The display name of the explorer in the Extensions view. */
const EXPLORER_NAME = 'Remote Explorer';

/** The hosts of the run's ssh_config. */
const HOSTS = hostAliases();

/** The server data folder of the host's user, where the server keeps its extensions. */
const SERVER_EXTENSIONS = '/home/harness/.vscodium-server-insiders/extensions';

/** A new local window on a folder of the run named `name`, showing the Remote Explorer. */
async function localViewWindow(name: string): Promise<string> {
  const folder = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'connect-rows',
    name,
  );
  mkdirSync(folder, {recursive: true});
  const window = await openFolderWindow(folder);
  await inWindow(window, SHOW_REMOTE_EXPLORER);
  await rowsSettled(window, rowsOf(HOSTS, undefined));
  return window;
}

/** Waits until window `name` is connected to `alias`. */
async function connectedTo(name: string, alias: string): Promise<void> {
  await waitFor(
    `window ${name} to connect to ${alias}`,
    async () =>
      (await windowState(name)).remoteAuthority === `ssh-remote+${alias}`,
    120_000,
  );
}

/** The window, folders and remote of `name`, as the agent reports them. */
async function placeOf(name: string): Promise<[string | null, string[]]> {
  const state = await windowState(name);
  return [state.remoteName, state.folders];
}

describe('the view in SSH windows and its connect actions (card coverage-25c, part b)', function () {
  this.timeout(360_000);

  before(() => rememberPage('local'));

  it("F-5001 AC-7, F-5101 AC-18, F-5901 AC-9, F-5103 AC-37 (ssh-window): an SSH window's view lists the client's hosts with the connected one marked, Refresh works, nothing is shown, and the server's extensions folder holds nothing of the explorer", async () => {
    const name = 'xp-ssh-view';
    await openWindow('harness', name);
    try {
      await connectedTo(name, 'harness');
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await rowsSettled(name, rowsOf(HOSTS, 'harness'));
      await titleAction(name, VIEW, 'Refresh');
      await rowsSettled(name, rowsOf(HOSTS, 'harness'));
      await nothingFails(name);
      const serverExtensions = await onHost(
        'sh',
        '-c',
        `ls ${SERVER_EXTENSIONS} 2>/dev/null || true`,
      );
      deepStrictEqual(serverExtensions.includes('remote-explorer'), false);
    } finally {
      await closeWindow(name);
    }
  });

  it("F-5001 AC-6 (not-installed-remotely): in an SSH window the Extensions view lists the explorer under Local - Installed only, its menu has no Install in SSH item, and the server's extensions folder holds nothing of it", async () => {
    const name = 'xp-ssh-extensions';
    await openWindow('harness', name);
    try {
      await connectedTo(name, 'harness');
      await inWindow(name, 'workbench.view.extensions');
      await inWindow(
        name,
        'workbench.extensions.action.clearExtensionsSearchResults',
      );
      await waitFor(
        'the Extensions view to list the explorer',
        async () =>
          (await extensionsViewSections(name)).some(section =>
            section.entries.includes(EXPLORER_NAME),
          ),
        30_000,
      );
      const sections = await extensionsViewSections(name);
      const serverExtensions = await onHost(
        'sh',
        '-c',
        `ls ${SERVER_EXTENSIONS} 2>/dev/null || true`,
      );
      deepStrictEqual(
        [
          sections
            .filter(section => section.entries.includes(EXPLORER_NAME))
            .map(section => section.title),
          (await extensionContextMenu(name, EXPLORER_NAME)).filter(label =>
            label.startsWith('Install in SSH'),
          ),
          serverExtensions.includes('remote-explorer'),
        ],
        [['Local - Installed'], [], false],
      );
    } finally {
      await closeWindow(name);
    }
  });

  it('F-5902 AC-31 (workspace-folders): as folders are added to a connected SSH window and one is removed, the view lists the hosts with harness marked connected on its first render, and no notification appears', async () => {
    const name = 'xp-ssh-workspace';
    const savedSettings = readUserSettings();
    // Closing an untitled workspace otherwise asks, in a dialog of the main process, whether to save it.
    await userSettings({'window.confirmSaveUntitledWorkspace': false});
    const second = 'xp-ssh-workspace-second';
    const third = 'xp-ssh-workspace-third';
    await onHost(
      'mkdir',
      '-p',
      `/home/harness/${second}`,
      `/home/harness/${third}`,
    );
    await openWindow('harness', name);
    function remote(folder: string): string {
      return `vscode-remote://ssh-remote+harness/home/harness/${folder}`;
    }
    /** The host rows of the first render after the view is shown. */
    async function firstRender(): Promise<RenderedRow[]> {
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      let rows: RenderedRow[] = [];
      await waitFor(
        `window ${name} to render its hosts`,
        async () => {
          rows = (await renderedRows(name, VIEW)).filter(
            rendered => rendered.level === 2,
          );
          return rows.length > 0;
        },
        30_000,
      );
      return rows;
    }
    const seen: unknown[] = [];
    let failure: Error | undefined;
    try {
      await connectedTo(name, 'harness');
      const steps: ReadonlyArray<readonly [number, number, string[], number]> =
        [
          [1, 0, [remote(second)], 2],
          [2, 0, [remote(third)], 3],
          [1, 1, [], 2],
        ];
      for (const [start, deleteCount, uris, folders] of steps) {
        if (folders === 2 && deleteCount === 0) {
          await reloadingCommand(
            name,
            'acceptance.agent.updateWorkspaceFolders',
            start,
            deleteCount,
            uris,
          );
          await connectedTo(name, 'harness');
        } else {
          await inWindow(
            name,
            'acceptance.agent.updateWorkspaceFolders',
            start,
            deleteCount,
            uris,
          );
        }
        await waitFor(
          `window ${name} to hold ${String(folders)} folders`,
          async () => (await windowState(name)).folders.length === folders,
          60_000,
        );
        const first = await firstRender();
        await rowsSettled(name, rowsOf(HOSTS, 'harness'));
        seen.push([
          folders,
          first.find(each => each.label === 'harness')?.description,
          await notifications(name),
          recordLines('notice', name),
        ]);
      }
      deepStrictEqual(seen, [
        [2, 'connected', [], []],
        [3, 'connected', [], []],
        [2, 'connected', [], []],
      ]);
    } catch (caught) {
      failure =
        caught instanceof Error
          ? caught
          : new Error('the row failed', {cause: caught});
    }
    try {
      await closeWindow(name);
    } catch (caught) {
      failure ??=
        caught instanceof Error
          ? caught
          : new Error('the close failed', {cause: caught});
    }
    restoreUserSettings(savedSettings);
    if (failure !== undefined) {
      throw failure;
    }
  });

  it('F-5103 AC-4, AC-5, AC-6 (new-window): Connect in New Window from a folder window opens exactly one empty window on the host within 10 s, with no picker or notice, the new window marks the host connected with vm-active, and the first window is unchanged and marks nothing', async () => {
    const from = await localViewWindow('connect-from');
    const settingsBefore = readFileSync(userSettingsFile(), 'utf8');
    const placeBefore = await placeOf(from);
    const countBefore = windowNames().length;
    const clicked = Date.now();
    const opened = await nextEmptyWindow(() =>
      rowAction(from, VIEW, 'harness', IN_NEW),
    );
    const openSeconds = (Date.now() - clicked) / 1000;
    try {
      await connectedTo(opened, 'harness');
      await new Promise(resolve => setTimeout(resolve, 10_000));
      await inWindow(opened, SHOW_REMOTE_EXPLORER);
      await rowsSettled(opened, rowsOf(HOSTS, 'harness'));
      const harnessRow = (await rowDetails(opened, VIEW))?.find(
        viewRow => viewRow.label === 'harness',
      );
      await titleAction(from, VIEW, 'Refresh');
      await rowsSettled(from, rowsOf(HOSTS, undefined));
      deepStrictEqual(
        [
          openSeconds <= 10,
          windowNames().length - countBefore,
          await placeOf(opened),
          (await statusItem(opened, 'status.host')).text.includes(
            'SSH: harness',
          ),
          harnessRow?.icon,
          await placeOf(from),
          recordLines('pick', from),
          readFileSync(userSettingsFile(), 'utf8') === settingsBefore,
        ],
        [true, 1, ['ssh-remote', []], true, 'vm-active', placeBefore, [], true],
      );
      await nothingFails(from);
    } finally {
      await closeWindow(opened);
      await closeWindow(from);
    }
  });

  it('F-5103 AC-12, AC-13 (from-ssh): from an SSH folder window, Connect in New Window opens a further empty window on the host and leaves the SSH window as it was, and Connect in Current Window reloads it onto the host with no folder', async () => {
    const name = 'xp-ssh-folder';
    await openWindow('harness', name);
    let further = '';
    let reloaded = '';
    try {
      await connectedTo(name, 'harness');
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await rowsSettled(name, rowsOf(HOSTS, 'harness'));
      const before = await placeOf(name);
      further = await nextEmptyWindow(() =>
        rowAction(name, VIEW, 'harness', IN_NEW),
      );
      await connectedTo(further, 'harness');
      const sshAfterNew = await placeOf(name);
      reloaded = await nextEmptyWindow(() =>
        rowAction(name, VIEW, 'harness', CURRENT),
      );
      await connectedTo(reloaded, 'harness');
      deepStrictEqual(
        [await placeOf(further), sshAfterNew, before, await placeOf(reloaded)],
        [
          ['ssh-remote', []],
          before,
          [
            'ssh-remote',
            ['vscode-remote://ssh-remote%2Bharness/home/harness/xp-ssh-folder'],
          ],
          ['ssh-remote', []],
        ],
      );
    } finally {
      for (const window of [further, reloaded, name]) {
        if (window !== '' && isOpen(window)) {
          await closeWindow(window);
        }
      }
    }
  });

  it('F-5103 AC-17, F-5101 AC-19 (refused): a host that refuses opens a new window that shows the connection error, the first window is unchanged, the failed window lists the hosts as a local one with none connected and Refresh working, and Connect in Current Window connects it to a reachable host', async () => {
    const from = await localViewWindow('connect-refused');
    const placeBefore = await placeOf(from);
    const failed = await nextEmptyWindow(() =>
      rowAction(from, VIEW, 'refused', IN_NEW),
    );
    let recovered = '';
    try {
      await waitFor(
        `window ${failed} to show the connection error`,
        () => recordLines('failureDialog', failed).length > 0,
        120_000,
      );
      await inWindow(failed, SHOW_REMOTE_EXPLORER);
      await rowsSettled(failed, rowsOf(HOSTS, undefined));
      await titleAction(failed, VIEW, 'Refresh');
      await rowsSettled(failed, rowsOf(HOSTS, undefined));
      recovered = await nextEmptyWindow(() =>
        rowAction(failed, VIEW, 'harness', CURRENT),
      );
      await connectedTo(recovered, 'harness');
      deepStrictEqual(await placeOf(from), placeBefore);
      await nothingFails(from);
    } finally {
      for (const window of [recovered, failed, from]) {
        if (window !== '' && isOpen(window)) {
          await closeWindow(window);
        }
      }
    }
  });

  it('F-5103 AC-18 (unresolvable): Connect in Current Window on a name that never resolves shows the connection error and writes nothing, and after Close Remote Connection the window is usable and connects to a reachable host', async () => {
    const from = await localViewWindow('connect-nowhere');
    const settingsBefore = readFileSync(userSettingsFile(), 'utf8');
    const failed = await nextEmptyWindow(() =>
      rowAction(from, VIEW, 'nowhere', CURRENT),
    );
    let closed = '';
    let connected = '';
    try {
      await waitFor(
        `window ${failed} to show the connection error`,
        () => recordLines('failureDialog', failed).length > 0,
        120_000,
      );
      const settingsAfter = readFileSync(userSettingsFile(), 'utf8');
      closed = await nextEmptyWindow(() =>
        inWindow(failed, 'workbench.action.remote.close'),
      );
      await inWindow(closed, SHOW_REMOTE_EXPLORER);
      await rowsSettled(closed, rowsOf(HOSTS, undefined));
      const remoteAfterClose = (await placeOf(closed))[0];
      connected = await nextEmptyWindow(() =>
        rowAction(closed, VIEW, 'harness', CURRENT),
      );
      await connectedTo(connected, 'harness');
      deepStrictEqual(
        [settingsAfter === settingsBefore, remoteAfterClose],
        [true, null],
      );
    } finally {
      for (const window of [connected, closed, failed]) {
        if (window !== '' && isOpen(window)) {
          await closeWindow(window);
        }
      }
    }
  });
});
