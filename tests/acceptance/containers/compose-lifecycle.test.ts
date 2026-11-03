import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  reloadingCommand,
  reopenStarted,
  variable,
  waitFor,
  withLogTail,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {answerDialog, dialogOf, waitForDialog} from '../windows/renderer.ts';
import {
  composeFolder,
  dockerRun,
  openedCompose,
  printedIn,
  removeComposeContainers,
  serviceContainerOf,
} from '../windows/compose-support.ts';

/** How long a rebuild may take. */
const REBUILD_MILLISECONDS = 240_000;

/** The ids of the containers of the primary service `app` and of `db` in `project`. */
async function idsOf(
  project: string,
): Promise<{primary: string; sibling: string}> {
  return {
    primary: await serviceContainerOf(project, 'app'),
    sibling: await serviceContainerOf(project, 'db'),
  };
}

describe('the containers of a Compose project that a window finds again (card containers-143, part C)', function () {
  this.timeout(600_000);

  afterEach(async () => {
    await removeComposeContainers();
  });

  it('F-0409 AC-27 (c143-reuse): after the primary container is stopped or paused (with Retry after the paused error) the same one is used, after it is removed a new one is made, and the other service’s container keeps its id in all three', async () => {
    const folder = composeFolder({name: 'c143-reuse', place: 'devcontainer'});
    const first = await openedCompose(folder);
    const original = await idsOf(first.project);
    await closeWindow(first.name);

    await dockerRun('stop', original.primary);
    const stopped = await openedCompose(folder);
    const afterStop = await idsOf(first.project);
    await closeWindow(stopped.name);

    await dockerRun('pause', original.primary);
    const pausedWindow = await openFolderWindow(folder);
    await reopenStarted(pausedWindow);
    const pausedDialog = await waitForDialog(pausedWindow, 180_000);
    await answerDialog(pausedWindow, 'Retry');
    await connectedToContainer(pausedWindow, REBUILD_MILLISECONDS);
    const afterPause = await idsOf(first.project);
    await closeWindow(pausedWindow);

    await dockerRun('rm', '--force', original.primary);
    const removed = await openedCompose(folder);
    const afterRemoval = await idsOf(first.project);
    await closeWindow(removed.name);

    deepStrictEqual(
      {
        pausedDialog: pausedDialog.details || pausedDialog.message,
        sameAfterStop: afterStop.primary === original.primary,
        sameAfterPause: afterPause.primary === original.primary,
        newAfterRemoval:
          afterRemoval.primary !== '' &&
          afterRemoval.primary !== original.primary,
        dbKept: [afterStop.sibling, afterPause.sibling, afterRemoval.sibling],
      },
      {
        pausedDialog: 'An error occurred setting up the container.',
        sameAfterStop: true,
        sameAfterPause: true,
        newAfterRemoval: true,
        dbKept: [original.sibling, original.sibling, original.sibling],
      },
    );
  });

  it('F-0405 AC-21 (c143-rebuild): a rebuild without cache removes and recreates every service of the project and rebuilds both images with every RUN step, and a plain rebuild recreates both from the cache, leaving no dangling image', async () => {
    const root = path.join(variable('HARNESS_RUN_FOLDER'), 'c143-rebuild');
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    const folder = composeFolder({
      name: 'c143-rebuild',
      place: 'devcontainer',
      composeText: [
        'services:',
        '  app:',
        '    build: ./app',
        '    command: sleep infinity',
        '    volumes:',
        '      - "..:/workspaces/c143-rebuild"',
        '    labels:',
        `      - "remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}"`,
        '      - "remote-oss.acceptance.devcontainer=1"',
        '  tools:',
        '    build: ./tools',
        '    command: sleep infinity',
        '    labels:',
        `      - "remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}"`,
        '      - "remote-oss.acceptance.devcontainer=1"',
        '',
      ].join('\n'),
      configuration: {service: 'app'},
    });
    for (const service of ['app', 'tools']) {
      const where = path.join(root, '.devcontainer', service);
      mkdirSync(where, {recursive: true});
      writeFileSync(
        path.join(where, 'Dockerfile'),
        `FROM ${image}\nRUN date +%s%N > /marker\n`,
      );
    }
    const connected = await openedCompose(folder);
    async function readState(): Promise<{
      containerIds: string[];
      imageIds: string[];
      markers: string[];
    }> {
      const primary = await serviceContainerOf(connected.project, 'app');
      const tools = await serviceContainerOf(connected.project, 'tools');
      return {
        containerIds: [primary, tools],
        imageIds: [
          await dockerRun('inspect', '-f', '{{.Image}}', primary),
          await dockerRun('inspect', '-f', '{{.Image}}', tools),
        ],
        markers: [
          await printedIn(primary, 'cat /marker'),
          await printedIn(tools, 'cat /marker'),
        ],
      };
    }
    async function rebuild(command: string): Promise<void> {
      const before = await serviceContainerOf(connected.project, 'app');
      await reloadingCommand(connected.name, command);
      try {
        await waitFor(
          'the rebuild to make a new primary container',
          async () => {
            const now = await serviceContainerOf(connected.project, 'app');
            return now !== '' && now !== before;
          },
          REBUILD_MILLISECONDS,
        );
      } catch (caught) {
        throw new Error(
          withLogTail(
            `${caught instanceof Error ? caught.message : String(caught)}\ndialog: ${JSON.stringify(await dialogOf(connected.name).catch(() => 'unreadable'))}`,
            containersLog(),
          ),
          {cause: caught},
        );
      }
      await connectedToContainer(connected.name, REBUILD_MILLISECONDS);
    }
    const original = await readState();
    await rebuild('remote-containers.rebuildContainerNoCache');
    const clean = await readState();
    await rebuild('remote-containers.rebuildContainer');
    const cached = await readState();
    const dangling = await dockerRun(
      'images',
      '--quiet',
      '--filter',
      'dangling=true',
    );
    const siblingImage = await dockerRun(
      'inspect',
      '-f',
      '{{.Config.Image}}',
      cached.containerIds[1] ?? '',
    );
    await closeWindow(connected.name);
    deepStrictEqual(
      {
        freshAfterNoCache: clean.containerIds.every(
          containerId => !original.containerIds.includes(containerId),
        ),
        markersChangedAfterNoCache: clean.markers.every(
          (marker, index) => marker !== original.markers[index],
        ),
        freshAfterPlain: cached.containerIds.every(
          containerId => !clean.containerIds.includes(containerId),
        ),
        markersKeptAfterPlain: cached.markers.join() === clean.markers.join(),
        freshImagesAfterPlain: cached.imageIds.every(
          imageId => !clean.imageIds.includes(imageId),
        ),
        freshImagesAfterNoCache: clean.imageIds.every(
          imageId => !original.imageIds.includes(imageId),
        ),
        dangling,
        siblingDerived: siblingImage.startsWith('vsc-'),
      },
      {
        freshAfterNoCache: true,
        markersChangedAfterNoCache: true,
        freshAfterPlain: true,
        markersKeptAfterPlain: true,
        freshImagesAfterPlain: true,
        freshImagesAfterNoCache: true,
        dangling: '',
        siblingDerived: false,
      },
    );
  });
});
