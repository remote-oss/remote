import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainersOf,
  dockerVolumes,
  reloadingCommand,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';
import {docker, eventually, settledWindow} from './resolve-support.ts';

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
      (await statusBarText(window, 'status.host')) ===
      'Dev Container: c67-mount'
        ? true
        : undefined,
    120_000,
  );
  return {window, dialog};
}

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
      const first = await rebuilt(name, [name, 'workspace']);
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
      const second = await rebuilt(first.window, [first.window, 'inner', name]);
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
});
