import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reloadingCommand,
  variable,
  windowEvents,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {chooseQuickPickRow, quickPickOf} from '../windows/renderer.ts';
import {docker, eventually} from './resolve-support.ts';

/** How long the last RUN step of the rebuilt Dockerfile takes, in seconds. */
const STEP_SECONDS = 45;

/** The ids of the host's processes whose command line holds `needle`: the image build of a folder holds its image tag. */
async function buildersOf(needle: string): Promise<number[]> {
  try {
    const {stdout} = await promisify(execFile)('pgrep', ['-f', needle]);
    return stdout
      .split('\n')
      .filter(line => line !== '')
      .map(Number)
      .filter(processId => processId !== process.pid);
  } catch {
    return [];
  }
}

/** The names of the windows that are open now: an agent that has not deactivated last. */
function liveWindows(): string[] {
  return windowNames().filter(
    each => windowEvents(each).at(-1)?.event !== 'deactivated',
  );
}

/** The image objects of `prefix`, as `repository|id` lines. */
async function imagesOf(prefix: string): Promise<string[]> {
  return (
    await docker('images', '--no-trunc', '--format', '{{.Repository}}|{{.ID}}')
  )
    .split('\n')
    .filter(line => line.startsWith(prefix));
}

/** The usage counts of the build-cache records whose description holds `marker`; a build that was ended leaves none or a count of 0. */
async function usageCounts(marker: string): Promise<string[]> {
  return (await docker('buildx', 'du', '--verbose'))
    .split('\n\n')
    .filter(record => record.includes(marker))
    .flatMap(record =>
      record.split('\n').filter(line => line.startsWith('Usage count:')),
    )
    .map(line => line.replace(/\s+/g, ' '));
}

describe('F-0405 Close Remote Connection during a rebuild (card coverage-67)', function () {
  this.timeout(900_000);

  // The window title of the emptied window cannot be read by the harness (two folderless windows match), so the plain
  // "Visual Studio Code" title is not asserted.
  /** Closes the remote connection during the last RUN step of a rebuild started the `variant` way, and judges what is left. */
  async function closedDuringRebuild(
    variant: 'connected' | 'local',
  ): Promise<void> {
    const prefix = `vsc-c67-close-${variant}`;
    const folder = devContainerFolder(`c67-close-${variant}`, {
      name: 'Close',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    const dockerfile = path.join(folder, '.devcontainer', 'Dockerfile');
    const base = variable('HARNESS_DEVCONTAINER_IMAGE');
    writeFileSync(dockerfile, `FROM ${base}\nRUN echo fast\n`);
    let name = await openFolderWindow(folder);
    try {
      await reloadingCommand(name, 'remote-containers.reopenInContainer');
      await connectedToContainer(name);
      if (variant === 'local') {
        await closeWindow(name);
        name = await openFolderWindow(folder);
      }
      const before = {
        images: await imagesOf(prefix),
        windows: liveWindows().length,
      };
      const marker = `c67-slow-${String(Date.now())}`;
      writeFileSync(
        dockerfile,
        `FROM ${base}\nRUN sleep ${String(STEP_SECONDS)}; echo ${marker}\n`,
      );
      await reloadingCommand(
        name,
        variant === 'connected'
          ? 'remote-containers.rebuildContainer'
          : 'remote-containers.rebuildAndReopenInContainer',
      );
      await eventually(
        'the build',
        async () => ((await buildersOf(prefix)).length > 0 ? true : undefined),
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
      await inWindow(name, 'workbench.action.remote.showMenu');
      await new Promise(resolve => setTimeout(resolve, 1500));
      const menu = (await quickPickOf(name))?.items;
      await chooseQuickPickRow(name, 'Close Remote Connection');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const processes = [
        ...(await buildersOf(prefix)),
        ...(await buildersOf(folder)),
      ];
      await new Promise(resolve => setTimeout(resolve, 4000));
      const [emptied = ''] = liveWindows().filter(each =>
        each.startsWith('empty'),
      );
      const emptiedState = await windowState(emptied);
      // The step would have ended by now had the build not been interrupted.
      await new Promise(resolve =>
        setTimeout(resolve, (STEP_SECONDS + 10) * 1000),
      );
      deepStrictEqual(
        {
          menu,
          windows: liveWindows().length,
          folderless: [emptiedState.remoteName, emptiedState.folders],
          processes,
          containers: await devContainersOf(folder),
          images: await imagesOf(prefix),
          usedRecords: (await usageCounts(marker)).filter(
            count => count !== 'Usage count: 0',
          ),
        },
        {
          menu: ['Close Remote Connection'],
          windows: before.windows,
          folderless: [null, []],
          processes: [],
          containers: [],
          images: before.images,
          usedRecords: [],
        },
      );
    } finally {
      await removeContainers(folder);
      for (const image of await imagesOf(prefix)) {
        await docker('image', 'rm', '--force', image.split('|')[1] ?? '').catch(
          () => undefined,
        );
      }
    }
  }

  it('F-0405 AC-16 (c67-close-connected): the remote indicator offers only Close Remote Connection during the last RUN step of Rebuild Container, which turns the window into an empty one with no container, no CLI or buildx process left, the image tags kept and the interrupted step’s cache entry never used', () =>
    closedDuringRebuild('connected'));

  it('F-0405 AC-16 (c67-close-local): the same for Rebuild and Reopen in Container run from a local window', () =>
    closedDuringRebuild('local'));
});
