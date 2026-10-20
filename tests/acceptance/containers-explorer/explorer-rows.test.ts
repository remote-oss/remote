/**
 * @fileoverview The Remote Explorer beside Dev Containers (card coverage-25c, part b): the order of its sections, its
 * rows as without Dev Containers, its activation in a dev container window, and its connect from there.
 */

import {deepStrictEqual} from 'node:assert';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  extensionActive,
  hostAliases,
  inWindow,
  nextEmptyWindow,
  reopenInContainer,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  remoteExplorerSections,
  rowAction,
  selectedRemote,
  selectRemote,
} from '../windows/renderer.ts';
import {rowsOf, rowsSettled, VIEW} from '../windows/explorer-rows.ts';

const EXPLORER = 'remote-oss.remote-explorer';
const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';

/** The hosts of the run's ssh_config. */
const HOSTS = hostAliases();

/** How long a dev container window stays untouched before a row asks whether the explorer activated. */
const UNTOUCHED_MILLISECONDS = 30_000;

describe('the Remote Explorer beside Dev Containers (card coverage-25c, part b)', function () {
  this.timeout(600_000);

  // This row must run before any row that selects an option of the Switch Remote dropdown: a selection stores
  // `remote.explorerType` in the launch's profile, and with a stored type the explorer follows it. This file sorts
  // before gate.test.ts, and its own rows that select options come after this one.
  it('F-5101 AC-2 (sections-first): with no target type stored, the sections of the Remote Explorer start with Remotes (Tunnels/SSH), before Dev Containers and Help and feedback', async () => {
    const folder = devContainerFolder('x09-sections', {name: 'Sections'});
    const name = await openFolderWindow(folder);
    await inWindow(name, 'workbench.view.remote');
    let sections: string[] = [];
    await waitFor(
      'the sections of the Remote Explorer',
      async () => {
        sections = await remoteExplorerSections(name).catch(() => []);
        return sections.includes('Help and feedback');
      },
      60_000,
    );
    deepStrictEqual(
      {sections, selected: await selectedRemote(name)},
      {
        sections: [
          'Remotes (Tunnels/SSH)',
          'Dev Containers',
          'Help and feedback',
        ],
        selected: 'Dev Containers',
      },
    );
  });

  it('F-5101 AC-30 (sections): with Dev Containers installed, the Remotes section’s group and host rows are those of a window without it', async () => {
    const name = await openFolderWindow(
      devContainerFolder('explorer-sections', {name: 'Explorer Sections'}),
    );
    try {
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await selectRemote(name, VIEW);
      await rowsSettled(name, rowsOf(HOSTS, undefined));
    } finally {
      await closeWindow(name);
    }
  });

  it('F-5001 AC-8, F-5103 AC-14 (container-window): a dev container window leaves the explorer inactive, also when the Remote Explorer opens on Dev Containers; its focus command activates it with the client hosts and none connected, and Connect in Current Window turns the window into an empty SSH window', async () => {
    const folder = devContainerFolder('explorer-container', {
      name: 'Explorer Container',
    });
    const name = await openFolderWindow(folder);
    let reloaded = '';
    try {
      await reopenInContainer(name);
      await new Promise(resolve => setTimeout(resolve, UNTOUCHED_MILLISECONDS));
      const untouched = await extensionActive(name, EXPLORER);
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      await selectRemote(name, 'Dev Containers');
      const onDevContainers = await extensionActive(name, EXPLORER);
      await inWindow(name, 'remoteTargets.focus');
      await rowsSettled(name, rowsOf(HOSTS, undefined));
      const focused = await extensionActive(name, EXPLORER);
      reloaded = await nextEmptyWindow(() =>
        rowAction(name, VIEW, 'harness', 'Connect in Current Window...'),
      );
      await waitFor(
        `window ${reloaded} to connect to harness`,
        async () =>
          (await windowState(reloaded)).remoteAuthority ===
          'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          untouched,
          onDevContainers,
          focused,
          (await windowState(reloaded)).folders,
        ],
        [false, false, true, []],
      );
    } finally {
      if (reloaded !== '') {
        await closeWindow(reloaded);
      }
      await removeContainers(folder);
    }
  });
});
