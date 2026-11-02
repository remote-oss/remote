import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  windowState,
} from '../windows/harness.ts';
import {windowTitle} from '../windows/renderer.ts';
import {
  openWorkspaceWindow,
  removeContainers,
} from '../windows/folder-windows.ts';

describe('the harness opens a window on a workspace file (card containers-40 harness)', function () {
  this.timeout(600_000);

  it('containers-40 harness: a .code-workspace window is found by its workspace title, and Reopen in Container connects it', async () => {
    const folder = devContainerFolder('ws-folder', {name: 'WS'});
    // The configuration the reopen reads is the one beside the workspace file, so the file sits in the folder.
    const file = path.join(folder, 'ws-team.code-workspace');
    writeFileSync(file, JSON.stringify({folders: [{path: '.'}]}));
    try {
      const name = await openWorkspaceWindow(file);
      const local = await windowState(name);
      const localTitle = await windowTitle(name);
      await reopenInContainer(name);
      const remote = await windowState(name);
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {
          name,
          fileName: local.workspaceFile?.split('/').pop(),
          localTitle,
          remoteName: remote.remoteName,
          containers: containers.length,
        },
        {
          name: 'ws-folder',
          fileName: 'ws-team.code-workspace',
          localTitle: '[ws-team (Workspace)]',
          remoteName: 'dev-container',
          containers: 1,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
