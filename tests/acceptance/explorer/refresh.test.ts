/**
 * @fileoverview When the SSH group reads its hosts again (card coverage-25c, part b): only on Refresh, never because
 * the view is shown again, a file changed or another window refreshed; a collapsed group stays collapsed; and a long
 * file is listed whole. Each row names a configuration file of its own with `remote.SSH.configFile`.
 */

import {deepStrictEqual} from 'node:assert';
import {appendFileSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  notifications,
  titleAction,
  toggleRow,
  viewRows,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';

const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';
const SHOW_FILE_EXPLORER = 'workbench.view.explorer';

/** How long a row waits to be sure the group did not read its hosts by itself. */
const UNCHANGED_MILLISECONDS = 10_000;

/** The run's folder for this file's configuration files and windows. */
function refreshFolder(): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'refresh-rows');
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** A configuration file of `hosts`, one `Host` line each, named `name` in this file's folder. */
function configOf(name: string, hosts: readonly string[]): string {
  const file = path.join(refreshFolder(), name);
  writeFileSync(file, hosts.map(host => `Host ${host}\n`).join(''));
  return file;
}

/** A new folder window named `name` showing the Remote Explorer. */
async function viewWindow(name: string): Promise<string> {
  const folder = path.join(refreshFolder(), name);
  mkdirSync(folder, {recursive: true});
  const window = await openFolderWindow(folder);
  await inWindow(window, SHOW_REMOTE_EXPLORER);
  return window;
}

/** The labels of the group's host rows in `window`, in order, as the view shows them now. */
async function hostLabels(window: string): Promise<string[]> {
  return ((await viewRows(window, VIEW)) ?? [])
    .filter(viewRow => viewRow.level === 2)
    .map(viewRow => viewRow.label);
}

/** Waits until `window` lists exactly `hosts` under the group. */
async function listing(
  window: string,
  hosts: readonly string[],
): Promise<void> {
  await waitFor(
    `window ${window} to list ${hosts.join(', ')}`,
    async () =>
      JSON.stringify(await hostLabels(window)) === JSON.stringify(hosts),
    15_000,
  );
}

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('when the SSH group reads its hosts again (card coverage-25c, part b)', function () {
  this.timeout(300_000);
  let savedSettings: string | undefined;

  beforeEach(() => {
    savedSettings = readUserSettings();
  });

  afterEach(() => {
    restoreUserSettings(savedSettings);
  });

  it('F-5101 AC-28, F-5102 AC-34 (hidden-then-shown): a host added while another side bar is in front is not listed when the view is shown again, and a missing file filled by another program stays empty until Refresh', async () => {
    const config = configOf('hidden.conf', ['before-host']);
    const missing = path.join(refreshFolder(), 'missing.conf');
    rmSync(missing, {force: true});
    const window = await viewWindow('refresh-hidden');
    try {
      await userSettings({'remote.SSH.configFile': config});
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, ['before-host']);
      await inWindow(window, SHOW_FILE_EXPLORER);
      appendFileSync(config, 'Host added-hidden\n');
      await inWindow(window, SHOW_REMOTE_EXPLORER);
      await pause(UNCHANGED_MILLISECONDS);
      const shownAgain = await hostLabels(window);
      await userSettings({'remote.SSH.configFile': missing});
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, []);
      writeFileSync(missing, 'Host written-later\n');
      await pause(UNCHANGED_MILLISECONDS);
      const beforeRefresh = await hostLabels(window);
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, ['written-later']);
      deepStrictEqual([shownAgain, beforeRefresh], [['before-host'], []]);
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5101 AC-11 (collapsed): a collapsed SSH group stays collapsed on Refresh, and expanding it shows the current hosts', async () => {
    const config = configOf('collapsed.conf', ['one-host']);
    const window = await viewWindow('refresh-collapsed');
    try {
      await userSettings({'remote.SSH.configFile': config});
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, ['one-host']);
      await toggleRow(window, VIEW, 'SSH');
      appendFileSync(config, 'Host two-host\n');
      await titleAction(window, VIEW, 'Refresh');
      await pause(2_000);
      const collapsed = await viewRows(window, VIEW);
      await toggleRow(window, VIEW, 'SSH');
      await listing(window, ['one-host', 'two-host']);
      deepStrictEqual(collapsed, [
        {label: 'SSH', description: '', level: 1, expanded: false},
      ]);
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5101 AC-39 (two-windows): Refresh in one window lists a new host there only, and the other window keeps its old list', async () => {
    const config = configOf('two-windows.conf', ['shared-host']);
    await userSettings({'remote.SSH.configFile': config});
    const first = await viewWindow('refresh-first');
    const second = await viewWindow('refresh-second');
    try {
      await listing(first, ['shared-host']);
      await listing(second, ['shared-host']);
      appendFileSync(config, 'Host new-host\n');
      await titleAction(first, VIEW, 'Refresh');
      await listing(first, ['shared-host', 'new-host']);
      await pause(UNCHANGED_MILLISECONDS);
      deepStrictEqual(await hostLabels(second), ['shared-host']);
    } finally {
      await closeWindow(first);
      await closeWindow(second);
    }
  });

  it("F-5101 AC-44, F-5902 AC-28 (editor-save): a host saved into the configuration file through the editor, or added by another program before an unrelated save, isn't listed 10 s later, and Refresh lists it", async () => {
    const config = configOf('editor-save.conf', ['saved-before']);
    const window = await viewWindow('refresh-editor');
    try {
      await userSettings({'remote.SSH.configFile': config});
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, ['saved-before']);
      await inWindow(
        window,
        'acceptance.agent.writeFile',
        pathToFileURL(config).href,
        'Host saved-before\nHost saved-in-editor\n',
      );
      await pause(UNCHANGED_MILLISECONDS);
      const afterEditor = await hostLabels(window);
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, ['saved-before', 'saved-in-editor']);
      appendFileSync(config, 'Host added-outside\n');
      await inWindow(
        window,
        'acceptance.agent.writeFile',
        'unrelated.txt',
        'x',
      );
      await pause(UNCHANGED_MILLISECONDS);
      const afterUnrelated = await hostLabels(window);
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, [
        'saved-before',
        'saved-in-editor',
        'added-outside',
      ]);
      deepStrictEqual(
        [afterEditor, afterUnrelated],
        [['saved-before'], ['saved-before', 'saved-in-editor']],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5101 AC-22 (three-hundred): 300 hosts are listed from first to last within 5 s of the show, a 301st is the last row within 5 s of Refresh, and nothing is shown meanwhile', async () => {
    const hosts = Array.from(
      {length: 300},
      (unused, index) => `bulk-${String(index + 1).padStart(3, '0')}`,
    );
    const config = configOf('three-hundred.conf', hosts);
    await userSettings({'remote.SSH.configFile': config});
    const folder = path.join(refreshFolder(), 'refresh-bulk');
    mkdirSync(folder, {recursive: true});
    const window = await openFolderWindow(folder);
    try {
      const shown = Date.now();
      await inWindow(window, SHOW_REMOTE_EXPLORER);
      await listing(window, hosts);
      const showSeconds = (Date.now() - shown) / 1000;
      appendFileSync(config, 'Host bulk-301\n');
      const clicked = Date.now();
      await titleAction(window, VIEW, 'Refresh');
      await listing(window, [...hosts, 'bulk-301']);
      deepStrictEqual(
        [
          showSeconds <= 5,
          (Date.now() - clicked) / 1000 <= 5,
          await notifications(window),
        ],
        [true, true, []],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
