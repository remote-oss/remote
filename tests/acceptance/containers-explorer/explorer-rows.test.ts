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
  remoteExplorerOptions,
  rowAction,
  selectRemote,
} from '../windows/renderer.ts';
import {rowsOf, rowsSettled, VIEW} from '../explorer/explorer-rows.ts';

const EXPLORER = 'remote-oss.remote-explorer';
const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';

/** The hosts of the run's ssh_config. */
const HOSTS = hostAliases();

/** How long a dev container window stays untouched before a row asks whether the explorer activated. */
const UNTOUCHED_MILLISECONDS = 30_000;

describe('the Remote Explorer beside Dev Containers (card coverage-25c, part b)', function () {
  this.timeout(600_000);

  it('F-5101 AC-2, AC-30 (sections): the Remotes section comes before Dev Containers, and its group and host rows are those of a window without Dev Containers', async () => {
    const name = await openFolderWindow(
      devContainerFolder('explorer-sections', {name: 'Explorer Sections'}),
    );
    try {
      await inWindow(name, SHOW_REMOTE_EXPLORER);
      const options = await remoteExplorerOptions(name);
      await selectRemote(name, VIEW);
      await rowsSettled(name, rowsOf(HOSTS, undefined));
      deepStrictEqual(options.slice(0, 2), [VIEW, 'Dev Containers']);
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
