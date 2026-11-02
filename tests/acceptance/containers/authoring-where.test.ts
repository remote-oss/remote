import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  startInWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  answerDialog,
  detailedQuickPickRows,
  dialogKindOf,
  dialogOf,
  dialogText,
  primaryButtonOf,
  quickPickFacts,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  chooseWorkspace,
  closeScreen,
  rowsOf,
  withWindow,
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

  for (const command of COMMANDS.slice(1)) {
    const label = command.includes('NoCache') ? 'nocache' : 'rebuild';
    it(`F-0405 AC-13 (c101-direct-${label}): in a folder with a configuration and no container, ${command} makes the container directly, with no stop or removal, runs postCreateCommand once and connects the window`, async () => {
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
          .filter(action =>
            ['die', 'kill', 'stop', 'destroy'].includes(action),
          );
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
      }
    });
  }

  for (const command of COMMANDS.slice(1)) {
    for (const existing of [false, true]) {
      const label = `${command.includes('NoCache') ? 'nocache' : 'rebuild'}-${existing ? 'with' : 'without'}`;
      it(`F-0405 AC-32 (c101-no-source-${label}): ${command} on a configuration with no container source ${existing ? 'and a stopped container' : 'and no container'} shows the modal warning, Cancel changes nothing and Use Template opens the template screen, and the container keeps its id and state`, async () => {
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
            async () =>
              (await containerStateOf(containerId)).endsWith(' exited'),
            90_000,
          );
        }
        writeFileSync(file, '{"name":"No Source"}');
        const before =
          containerId === '' ? '' : await containerStateOf(containerId);
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
        }
      });
    }
  }
});
