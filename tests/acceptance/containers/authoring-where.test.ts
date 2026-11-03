import {deepStrictEqual} from 'node:assert';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  isOpen,
  reopenInContainer,
  startInWindow,
  variable,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  answerFolderDialog,
  chooseQuickPickRow,
  detailedQuickPickRows,
  dialogKindOf,
  dialogOf,
  dialogText,
  primaryButtonOf,
  quickPickFacts,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {
  ALPINE_OPTION,
  chooseWorkspace,
  closeScreen,
  rowsOf,
  takeFeatureScreen,
  takeOptionScreen,
  withWindow,
  written,
} from '../windows/authoring-support.ts';
import {docker} from './resolve-support.ts';

/** The text of the modal for a configuration with no container source. */
const MISSING_IMAGE =
  "Dev Container configuration '.devcontainer/devcontainer.json' file is missing image information. You can add this manually or overwrite with a template.";

/** The id and the state of container `containerId`, or `gone`. */
async function containerStateOf(containerId: string): Promise<string> {
  try {
    return await docker(
      'inspect',
      '--format',
      '{{.Id}} {{.State.Status}}',
      containerId,
    );
  } catch {
    return 'gone';
  }
}

/** Removes every container the engine holds for `folder`, including one made from a configuration the wizard wrote, which has no label of the run. */
async function removeContainersLabelled(folder: string): Promise<void> {
  const containerIds = (
    await docker(
      'ps',
      '-a',
      '-q',
      '--filter',
      `label=devcontainer.local_folder=${folder}`,
    )
  )
    .split('\n')
    .filter(line => line !== '');
  if (containerIds.length > 0) {
    await docker('rm', '-f', ...containerIds);
  }
}

/** The commands that make a container from a folder: Reopen in Container and the two that rebuild and reopen. */
const COMMANDS = [
  'remote-containers.reopenInContainer',
  'remote-containers.rebuildAndReopenInContainer',
  'remote-containers.rebuildNoCacheAndReopenInContainer',
] as const;

/** The frame and the rows of the pick that asks where to create the configuration. */
const WHERE = {
  facts: {
    title: 'Add Dev Container Configuration Files',
    placeholder: 'Where would you like to create your container configuration?',
    titleButtons: [],
    multiSelect: false,
  },
  rows: [
    [
      'Add configuration to workspace',
      '',
      'This allows you to share the configuration with others via source control',
      true,
    ],
    [
      'Add configuration to user data folder',
      '',
      'This avoids having outgoing changes in your workspace folder',
      false,
    ],
  ],
} as const;

/** Runs `command` in a folder with a configuration and no container, as window `label`, and checks that it makes the container directly and connects. */
async function directRebuild(command: string, label: string): Promise<void> {
  const folder = devContainerFolder(`c101-direct-${label}`, {
    name: 'Direct',
    postCreateCommand: 'echo x >> marker-post-create',
  });
  const window = await openFolderWindow(folder);
  try {
    const began = Math.floor(Date.now() / 1000);
    await reopenInContainer(window, 300_000, command);
    const containers = await devContainersOf(folder);
    const events = (
      await docker(
        'events',
        '--since',
        String(began),
        '--until',
        String(Math.ceil(Date.now() / 1000) + 1),
        '--filter',
        `container=${containers[0] ?? ''}`,
        '--format',
        '{{.Action}}',
      )
    )
      .split('\n')
      .filter(action => ['die', 'kill', 'stop', 'destroy'].includes(action));
    deepStrictEqual(
      [
        (await windowState(window)).remoteName,
        containers.length,
        events,
        readFileSync(path.join(folder, 'marker-post-create'), 'utf8')
          .split('\n')
          .filter(line => line !== '').length,
      ],
      ['dev-container', 1, [], 1],
    );
  } finally {
    await closeWindow(window).catch(() => undefined);
    await removeContainers(folder);
  }
}

/** Runs `command` on a configuration with no container source, with or without a stopped container of the folder, as row `label`. */
async function noSourceRebuild(
  command: string,
  existing: boolean,
  label: string,
): Promise<void> {
  const folder = devContainerFolder(`c101-no-source-${label}`, {
    name: 'No Source',
  });
  const file = path.join(folder, '.devcontainer/devcontainer.json');
  let containerId = '';
  if (existing) {
    const first = await openFolderWindow(folder);
    await reopenInContainer(first);
    containerId = (await devContainersOf(folder))[0] ?? '';
    await closeWindow(first);
    await waitFor(
      'the container to be stopped',
      async () => (await containerStateOf(containerId)).endsWith(' exited'),
      90_000,
    );
  }
  writeFileSync(file, '{"name":"No Source"}');
  const before = containerId === '' ? '' : await containerStateOf(containerId);
  const window = await openFolderWindow(folder);
  try {
    const seen: unknown[] = [];
    for (const answer of ['Cancel', 'Use Template'] as const) {
      await startInWindow(window, command);
      const dialog = await waitForDialog(window, 180_000);
      seen.push([
        await dialogText(window),
        await dialogKindOf(window),
        dialog.buttons,
        await primaryButtonOf(window),
      ]);
      await answerDialog(window, answer);
      if (answer === 'Use Template') {
        await waitForQuickPick(window, 180_000);
        await chooseWorkspace(window);
        seen.push(
          (await quickPickFacts(window))?.placeholder ===
            'Select a container configuration template or enter a custom template id',
        );
        await closeScreen(window);
      }
    }
    deepStrictEqual(
      [
        seen,
        (await windowState(window)).remoteName,
        readFileSync(file, 'utf8'),
        containerId === '' ? '' : await containerStateOf(containerId),
        (await devContainersOf(folder)).length,
      ],
      [
        [
          [
            `CancelUse Template${MISSING_IMAGE}`,
            'warning',
            ['Cancel', 'Use Template'],
            'Use Template',
          ],
          [
            `CancelUse Template${MISSING_IMAGE}`,
            'warning',
            ['Cancel', 'Use Template'],
            'Use Template',
          ],
          true,
        ],
        null,
        '{"name":"No Source"}',
        before,
        existing ? 1 : 0,
      ],
    );
  } finally {
    await closeWindow(window).catch(() => undefined);
    await removeContainers(folder);
  }
}

describe('the commands that make a container from a folder with no configuration (card coverage-101)', function () {
  this.timeout(900_000);

  it('F-0401 AC-8, F-0405 AC-13, F-0301 AC-72 (c101-where): in a folder with no configuration each of Reopen in Container and the two rebuild commands creates no container and asks where to create the configuration, with no Back button, the workspace row focused and both rows with their second lines; Escape leaves the window local and writes nothing', async () => {
    await withWindow('c101-where', {}, async (window, folder) => {
      const seen: unknown[] = [];
      for (const command of COMMANDS) {
        await startInWindow(window, command);
        await waitForQuickPick(window, 180_000);
        seen.push([
          await quickPickFacts(window),
          await rowsOf(window),
          (await detailedQuickPickRows(window)).map(each => each.buttons),
        ]);
        await closeScreen(window);
        seen.push([
          (await windowState(window)).remoteName,
          await devContainersOf(folder),
          readdirSync(folder),
          await dialogOf(window),
        ]);
      }
      const picked = [WHERE.facts, WHERE.rows, [[], []]];
      const left = [null, [], [], undefined];
      deepStrictEqual(seen, [picked, left, picked, left, picked, left]);
    });
  });

  it('F-0405 AC-13 (c101-direct-rebuild): in a folder with a configuration and no container, remote-containers.rebuildAndReopenInContainer makes the container directly, with no stop or removal, runs postCreateCommand once and connects the window', async () => {
    await directRebuild(
      'remote-containers.rebuildAndReopenInContainer',
      'rebuild',
    );
  });

  it('F-0405 AC-13 (c101-direct-nocache): in a folder with a configuration and no container, remote-containers.rebuildNoCacheAndReopenInContainer makes the container directly, with no stop or removal, runs postCreateCommand once and connects the window', async () => {
    await directRebuild(
      'remote-containers.rebuildNoCacheAndReopenInContainer',
      'nocache',
    );
  });

  it('F-0405 AC-32 (c101-no-source-rebuild-without): remote-containers.rebuildAndReopenInContainer on a configuration with no container source and no container shows the modal warning, Cancel changes nothing and Use Template opens the template screen, and the container keeps its id and state', async () => {
    await noSourceRebuild(
      'remote-containers.rebuildAndReopenInContainer',
      false,
      'rebuild-without',
    );
  });

  it('F-0405 AC-32 (c101-no-source-rebuild-with): remote-containers.rebuildAndReopenInContainer on a configuration with no container source and a stopped container shows the modal warning, Cancel changes nothing and Use Template opens the template screen, and the container keeps its id and state', async () => {
    await noSourceRebuild(
      'remote-containers.rebuildAndReopenInContainer',
      true,
      'rebuild-with',
    );
  });

  it('F-0405 AC-32 (c101-no-source-nocache-without): remote-containers.rebuildNoCacheAndReopenInContainer on a configuration with no container source and no container shows the modal warning, Cancel changes nothing and Use Template opens the template screen, and the container keeps its id and state', async () => {
    await noSourceRebuild(
      'remote-containers.rebuildNoCacheAndReopenInContainer',
      false,
      'nocache-without',
    );
  });

  it('F-0405 AC-32 (c101-no-source-nocache-with): remote-containers.rebuildNoCacheAndReopenInContainer on a configuration with no container source and a stopped container shows the modal warning, Cancel changes nothing and Use Template opens the template screen, and the container keeps its id and state', async () => {
    await noSourceRebuild(
      'remote-containers.rebuildNoCacheAndReopenInContainer',
      true,
      'nocache-with',
    );
  });

  it('F-0301 AC-66 (c101-open-folder): Open Folder in Container on an empty target asks where while the window still shows the start folder, and after the workspace choice and Alpine the same window reloads onto the target, which holds the configuration while the start folder holds nothing, and connects as the target with the template name', async () => {
    const target = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'authoring',
      'c101-target',
    );
    rmSync(target, {recursive: true, force: true});
    mkdirSync(target, {recursive: true});
    await withWindow('c101-start', {}, async (window, folder) => {
      const openBefore = windowNames().filter(isOpen).length;
      await startInWindow(window, 'remote-containers.openFolder');
      await answerFolderDialog(window, target);
      await waitForQuickPick(window, 180_000);
      const asked = [
        await quickPickFacts(window),
        await rowsOf(window),
        await windowTitle(window),
      ];
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, ALPINE_OPTION);
      await takeFeatureScreen(window);
      await written(path.join(target, '.devcontainer/devcontainer.json'));
      await waitFor(
        'the window to be on the target',
        () => Promise.resolve(isOpen('c101-target')),
        180_000,
      );
      try {
        const trusting = waitForDialog('c101-target', 20_000).then(
          () => answerDialog('c101-target', 'Trust Folder & Continue'),
          () => undefined,
        );
        await connectedToContainer('c101-target', 300_000);
        await trusting;
        deepStrictEqual(
          [
            asked,
            readdirSync(folder),
            isOpen('c101-start'),
            windowNames().filter(isOpen).length === openBefore,
            await windowTitle('c101-target'),
          ],
          [
            [
              WHERE.facts,
              [
                [
                  'Add configuration to workspace',
                  '',
                  'This allows you to share the configuration with others via source control',
                  true,
                ],
                [
                  'Add configuration to user data folder',
                  '',
                  'This avoids having outgoing changes in your workspace folder',
                  false,
                ],
              ],
              `[${path.basename(folder)}]`,
            ],
            [],
            false,
            true,
            '[c101-target [Dev Container: Alpine]]',
          ],
        );
      } finally {
        await closeWindow('c101-target').catch(() => undefined);
        await removeContainersLabelled(target);
      }
    });
  });
});
