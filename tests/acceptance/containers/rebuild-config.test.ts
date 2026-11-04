import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainersOf,
  dockerVolumes,
  reloadingCommand,
  startInWindow,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  notificationCentre,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  NOTICE_START,
  docker,
  eventually,
  settledWindow,
} from './resolve-support.ts';

/** The dialog core shows when the container's workspace does not exist. */
const WORKSPACE_MISSING = 'Please select another workspace to open.';

/** Rewrites the configuration of `folder` with `changes` over what it holds. */
function changeConfiguration(
  folder: string,
  changes: Readonly<Record<string, unknown>>,
): void {
  const file = path.join(folder, '.devcontainer', 'devcontainer.json');
  writeFileSync(
    file,
    JSON.stringify({
      ...(JSON.parse(readFileSync(file, 'utf8')) as object),
      ...changes,
    }),
  );
}

/** The mount destinations of container `containerId`, sorted. */
async function destinationsOf(containerId: string): Promise<string[]> {
  const mounts = JSON.parse(
    await docker('inspect', '-f', '{{json .Mounts}}', containerId),
  ) as Array<{Destination: string}>;
  return mounts.map(each => each.Destination).sort();
}

/**
 * Runs the Rebuild Container command in the window of `folder` and waits for the window that follows: the window
 * keeps its name, or takes the one of the new folder; gives that name once it is connected, and the dialog core shows
 * for a workspace that does not exist, answered with Cancel, when one does.
 */
async function rebuilt(
  name: string,
  possible: readonly string[],
  host: string,
): Promise<{window: string; dialog: boolean}> {
  const before = windowNames().length;
  await reloadingCommand(name, 'remote-containers.rebuildContainer');
  const window = await eventually(
    'the rebuilt window',
    () =>
      Promise.resolve(
        windowNames().length >= before
          ? possible.find(each => windowNames().includes(each))
          : undefined,
      ),
    240_000,
  );
  let dialog = false;
  try {
    const shown = await waitForDialog(window, 120_000);
    dialog = shown.details === WORKSPACE_MISSING;
    await answerDialog(window, 'Cancel');
  } catch {
    await connectedToContainer(window);
  }
  await eventually(
    'the connected indicator',
    async () =>
      (await statusBarText(window, 'status.host')) === host ? true : undefined,
    120_000,
  );
  return {window, dialog};
}

/** The host the status bar of the `c67-mount` window's connection shows. */
const HOST_C67 = 'Dev Container: c67-mount';

describe('F-0405 Rebuild Container after workspaceMount and workspaceFolder change (card coverage-67)', function () {
  this.timeout(900_000);

  it('F-0405 AC-33 (c67-workspace-mount): a changed workspaceMount and workspaceFolder replace the container with one mounting /workspace and not /workspaces/<folder>, the named volume is kept and the window ends connected; a changed workspaceFolder alone ends connected with no dialog', async () => {
    const {name, containerId, folder} = await settledWindow('c67-mount');
    const base = path.basename(folder);
    mkdirSync(path.join(folder, 'inner'));
    try {
      const volumesBefore = await dockerVolumes();
      changeConfiguration(folder, {
        workspaceMount:
          'source=${localWorkspaceFolder},target=/workspace,type=bind',
        workspaceFolder: '/workspace',
      });
      const first = await rebuilt(name, [name, 'workspace'], HOST_C67);
      const [replacement = ''] = await devContainersOf(folder);
      const firstState = {
        replaced: replacement !== containerId,
        count: (await devContainersOf(folder)).length,
        destinations: (await destinationsOf(replacement)).filter(each =>
          each.startsWith('/workspace'),
        ),
        volumesKept:
          (await dockerVolumes()).filter(each => volumesBefore.includes(each))
            .length === volumesBefore.length,
        indicator: await statusBarText(first.window, 'status.host').catch(
          () => '',
        ),
      };
      changeConfiguration(folder, {
        workspaceMount: undefined,
        workspaceFolder: `/workspaces/${base}/inner`,
      });
      const second = await rebuilt(
        first.window,
        [first.window, 'inner', name],
        HOST_C67,
      );
      const secondState = {
        dialog: second.dialog,
        remoteName: (await windowState(second.window)).remoteName,
        again: (await dialogOf(second.window)) === undefined,
      };
      await closeWindow(second.window);
      deepStrictEqual(
        {
          firstState,
          secondDialogs: second.dialog,
          secondState,
          firstDialog: first.dialog,
        },
        {
          firstState: {
            replaced: true,
            count: 1,
            destinations: ['/workspace'],
            volumesKept: true,
            indicator: `Dev Container: c67-mount`,
          },
          secondDialogs: false,
          secondState: {
            dialog: false,
            remoteName: 'dev-container',
            again: true,
          },
          firstDialog: first.dialog,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-33 (c110-and-reopen): a changed workspaceMount and workspaceFolder give a replacement mounting /workspace, a changed workspaceFolder alone connects with no dialog, and Reopen Folder Locally then Rebuild and Reopen in Container opens the configured folder', async () => {
    const {name, containerId, folder} = await settledWindow('c110-and-reopen');
    const base = path.basename(folder);
    mkdirSync(path.join(folder, 'inner'));
    try {
      const host = `Dev Container: ${base}`;
      const volumesBefore = await dockerVolumes();
      changeConfiguration(folder, {
        workspaceMount:
          'source=${localWorkspaceFolder},target=/workspace,type=bind',
        workspaceFolder: '/workspace',
      });
      const first = await rebuilt(name, [name, 'workspace'], host);
      const [firstContainer = ''] = await devContainersOf(folder);
      const firstState = {
        replaced: firstContainer !== containerId,
        count: (await devContainersOf(folder)).length,
        destinations: (await destinationsOf(firstContainer)).filter(each =>
          each.startsWith('/workspace'),
        ),
        volumesKept:
          (await dockerVolumes()).filter(each => volumesBefore.includes(each))
            .length === volumesBefore.length,
        indicator: await statusBarText(first.window, 'status.host').catch(
          () => '',
        ),
      };
      changeConfiguration(folder, {
        workspaceMount: undefined,
        workspaceFolder: `/workspaces/${base}/inner`,
      });
      const second = await rebuilt(
        first.window,
        [first.window, 'inner', name],
        host,
      );
      const [secondContainer = ''] = await devContainersOf(folder);
      const secondState = {
        replaced: secondContainer !== firstContainer,
        dialog: second.dialog,
        indicator: await statusBarText(second.window, 'status.host').catch(
          () => '',
        ),
      };
      // Both reloads may rename the window, whose name is its folder's: Reopen Folder Locally
      // reopens the host folder the container was opened from (`name`), and the and-reopen pair
      // opens the configured folder (`inner`), so they are fired, not awaited on one name.
      await startInWindow(second.window, 'remote-containers.reopenLocally');
      await waitFor(
        'the discovery offer in the local window',
        async () =>
          (await notificationCentre(name).catch(() => [])).some(text =>
            text.startsWith(NOTICE_START),
          ),
        60_000,
      );
      const localState = await windowState(name);
      await startInWindow(
        name,
        'remote-containers.rebuildAndReopenInContainer',
      );
      const third = await eventually(
        'the window on the configured folder',
        () =>
          Promise.resolve(
            windowNames().includes('inner') ? 'inner' : undefined,
          ),
        240_000,
      );
      await connectedToContainer(third, 120_000);
      await eventually(
        'the connected indicator',
        async () =>
          (await statusBarText(third, 'status.host')) === host
            ? true
            : undefined,
        120_000,
      );
      const thirdState = {
        remoteName: (await windowState(third)).remoteName,
        indicator: await statusBarText(third, 'status.host').catch(() => ''),
        containers: (await devContainersOf(folder)).length,
      };
      await closeWindow(third);
      deepStrictEqual(
        {
          firstState,
          secondState,
          local: [localState.remoteName, localState.folders.length],
          third: [third, thirdState],
        },
        {
          firstState: {
            replaced: true,
            count: 1,
            destinations: ['/workspace'],
            volumesKept: true,
            indicator: host,
          },
          secondState: {
            replaced: true,
            dialog: false,
            indicator: host,
          },
          local: [null, 1],
          third: [
            'inner',
            {
              remoteName: 'dev-container',
              indicator: host,
              containers: 1,
            },
          ],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
