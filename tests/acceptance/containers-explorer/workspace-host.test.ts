/**
 * @fileoverview The explorer in a dev container's extension host (card coverage-25e, #1348): `remote.extensionKind`
 * moves it into the container, where it is installed with the container's server CLI.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {rowsOf, rowsSettled} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  extensionActive,
  hostAliases,
  inWindow,
  readUserSettings,
  recordLines,
  reloadingCommand,
  reopenInContainer,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {notifications} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

const EXPLORER = 'remote-oss.remote-explorer';

/** The explorer's package, as `pnpm package` writes it. */
const EXPLORER_PACKAGE = path.resolve('dist/remote-explorer-0.1.0.vsix');

describe('the explorer in a dev container’s extension host (card coverage-25e)', function () {
  this.timeout(600_000);

  it('F-5902 AC-3 (workspace-host): with remote.extensionKind workspace and the explorer installed in the container, the SSH group lists the hosts of the local configuration with no notification', async () => {
    const folder = devContainerFolder('explorer-workspace-host', {
      name: 'Explorer Workspace Host',
    });
    const saved = readUserSettings();
    await userSettings({
      'remote.extensionKind': {[EXPLORER]: ['workspace']},
    });
    const name = await openFolderWindow(folder);
    try {
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      await execFileAsync('docker', [
        'cp',
        EXPLORER_PACKAGE,
        `${containerId}:/tmp/remote-explorer.vsix`,
      ]);
      const {stdout: installed} = await execFileAsync('docker', [
        'exec',
        containerId,
        'sh',
        '-c',
        '$(ls -d /root/.vscodium-server-insiders/bin/*/bin/codium-server-insiders | head -1) --install-extension /tmp/remote-explorer.vsix',
      ]);
      await reloadingCommand(name, 'workbench.action.reloadWindow');
      await connectedToContainer(name, 300_000);
      await inWindow(name, 'workbench.view.remote');
      await inWindow(name, 'remoteTargets.focus');
      await rowsSettled(name, rowsOf(hostAliases(), undefined));
      deepStrictEqual(
        [
          installed.includes('successfully installed'),
          await extensionActive(name, EXPLORER),
          await notifications(name),
          recordLines('notice', name),
        ],
        [true, false, [], []],
      );
    } finally {
      restoreUserSettings(saved);
      await closeWindow(name);
      await removeContainers(folder);
    }
  });
});
