import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadWindow,
  reopenInContainer,
  reopenStarted,
  runLabelArguments,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  pageText,
  statusItem,
  type ShownDialog,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  activations,
  openFolderWindow,
  openWorkspaceWindow,
  removeContainers,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The string of the editor's table that the failed-setup dialog shows, and F-0410's three buttons, sorted. */
const S034 = 'An error occurred setting up the container.';
const RECOVERY_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** How long a connect that ends in a dialog takes. */
const DIALOG_MILLISECONDS = 180_000;

/** The output of `docker` run with `parameters`, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** The one container of `folder`; it fails when the number is not one. */
async function containerOf(folder: string): Promise<string> {
  const containers = await devContainersOf(folder);
  const [containerId] = containers;
  if (containerId === undefined || containers.length !== 1) {
    throw new Error(
      `expected one container of ${folder}, found ${String(containers.length)}`,
    );
  }
  return containerId;
}

/** The dialog's message, details and sorted buttons. */
function sayingOf(dialog: ShownDialog): {
  message: string;
  details: string;
  buttons: string[];
} {
  return {
    message: dialog.message,
    details: dialog.details,
    buttons: [...dialog.buttons].sort(),
  };
}

/** Opens `folder` in a window, reopens it in its container, and gives the window's name. */
async function reopened(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  return name;
}

/** The start time of container `containerId`, from `docker inspect`. */
function startedAt(containerId: string): Promise<string> {
  return docker('inspect', '-f', '{{.State.StartedAt}}', containerId);
}

/** Lets window `name` finish the background stage of its connect, which a stop during it would cut short. */
async function settled(name: string): Promise<void> {
  await waitFor(
    `window ${name} to show the connected indicator without the Configuring text`,
    async () =>
      !(await pageText(name)).includes('Configuring Dev Container (show log)'),
    120_000,
  );
}

/** Waits until window `name` reads the disconnected indicator under the configuration's name `containerName`. */
async function disconnected(
  name: string,
  containerName: string,
): Promise<void> {
  await waitFor(
    `window ${name} to read Disconnected from Dev Container: ${containerName}`,
    async () =>
      (await statusItem(name, 'status.host')).text ===
      `Disconnected from Dev Container: ${containerName}`,
    60_000,
  );
}

describe('F-0409 the container of a folder: stops, removals, failures and workspaces (card containers-52)', function () {
  this.timeout(900_000);

  it('F-0409 AC-9 (r9): a container stopped outside the editor leaves the window disconnected under its name, and reloading the window connects it to the same container, restarted', async () => {
    const folder = devContainerFolder('c52-stopped', {name: 'Stopped One'});
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      await settled(name);
      await docker('stop', containerId);
      await disconnected(name, 'Stopped One');
      const title = await windowTitle(name);
      await reloadWindow(name);
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      deepStrictEqual(
        [
          title,
          await devContainersOf(folder),
          await docker('inspect', '-f', '{{.State.Status}}', containerId),
        ],
        [
          '[c52-stopped [Dev Container: Stopped One]]',
          [containerId],
          'running',
        ],
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-12 (r12): a container removed outside the editor leaves the window disconnected under its name, and reloading the window recreates the container', async () => {
    const folder = devContainerFolder('c52-removed', {name: 'Removed One'});
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      await settled(name);
      await docker('rm', '-f', containerId);
      await disconnected(name, 'Removed One');
      await reloadWindow(name);
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      const [created = ''] = await devContainersOf(folder);
      deepStrictEqual(
        [
          created !== '' && created !== containerId,
          (await devContainersOf(folder)).length,
        ],
        [true, 1],
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-33 (r33): a window reloaded while its devcontainer.json is gone shows the generic dialog soon, the container untouched; Retry shows it again while the file is gone, and connects to the same container with no message once the file is back', async () => {
    const folder = devContainerFolder('c52-config-gone', {name: 'Config Gone'});
    const configuration = path.join(
      folder,
      '.devcontainer',
      'devcontainer.json',
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      await settled(name);
      const started = await startedAt(containerId);
      renameSync(configuration, `${configuration}.away`);
      const reloaded = Date.now();
      await reloadWindow(name);
      const dialog = await waitForDialog(name, 60_000);
      const seconds = (Date.now() - reloaded) / 1000;
      const shown = {
        saying: sayingOf(dialog),
        soon: seconds <= 15 ? true : seconds,
        indicator: (await statusItem(name, 'status.host')).text,
        title: await windowTitle(name),
        started: (await startedAt(containerId)) === started,
      };
      const missing = activations(name);
      await answerDialog(name, 'Retry');
      await waitFor(
        `window ${name} to activate again`,
        () => activations(name) > missing,
        60_000,
      );
      const again = await waitForDialog(name, 60_000);
      renameSync(`${configuration}.away`, configuration);
      const restored = activations(name);
      await answerDialog(name, 'Retry');
      await waitFor(
        `window ${name} to activate once more`,
        () => activations(name) > restored,
        60_000,
      );
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      deepStrictEqual(
        [
          shown,
          sayingOf(again),
          await devContainersOf(folder),
          await dialogOf(name),
          await notifications(name),
        ],
        [
          {
            saying: {message: '', details: S034, buttons: RECOVERY_BUTTONS},
            soon: true,
            indicator: 'Opening Remote...',
            title: '[c52-config-gone [Dev Container: Config Gone]]',
            started: true,
          },
          {message: '', details: S034, buttons: RECOVERY_BUTTONS},
          [containerId],
          undefined,
          [],
        ],
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-43 (r43): Edit devcontainer.json Locally on that dialog reopens the folder locally and creates no file', async () => {
    const folder = devContainerFolder('c52-config-gone-edit', {
      name: 'Config Gone Edit',
    });
    const configuration = path.join(
      folder,
      '.devcontainer',
      'devcontainer.json',
    );
    try {
      const name = await reopened(folder);
      await settled(name);
      renameSync(configuration, `${configuration}.away`);
      await reloadWindow(name);
      await waitForDialog(name, 60_000);
      const activated = activations(name);
      await answerDialog(name, 'Edit devcontainer.json Locally');
      await waitFor(
        `window ${name} to activate in its local folder`,
        () => activations(name) > activated,
        30_000,
      );
      deepStrictEqual(
        [existsSync(configuration), (await windowState(name)).remoteName],
        [false, null],
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-40, AC-46 (r40): a matching container whose main process exits at once, exited or restarting, is the one chosen again, with the generic dialog and no replacement', async () => {
    const seen: Array<[string, number, string[]]> = [];
    for (const [folderName, extra, expectedState] of [
      ['c52-exits-at-once', {}, 'exited'],
      [
        'c52-restarting',
        {runArgs: [...runLabelArguments(), '--restart', 'always']},
        'restarting',
      ],
    ] as const) {
      const folder = devContainerFolder(folderName, {
        name: folderName,
        image: undefined,
        build: {dockerfile: 'Dockerfile'},
        overrideCommand: false,
        ...extra,
      });
      mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
      writeFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nCMD ["true"]\n`,
      );
      try {
        const name = await openFolderWindow(folder);
        await reopenStarted(name);
        const first = await waitForDialog(name, DIALOG_MILLISECONDS);
        const [containerId = ''] = await devContainersOf(folder);
        await waitFor(
          `container ${containerId} to be ${expectedState}`,
          async () =>
            (await docker(
              'inspect',
              '-f',
              '{{.State.Status}}',
              containerId,
            )) === expectedState,
          30_000,
        );
        const activated = activations(name);
        await answerDialog(name, 'Retry');
        await waitFor(
          `window ${name} to activate again`,
          () => activations(name) > activated,
          60_000,
        );
        const again = await waitForDialog(name, DIALOG_MILLISECONDS);
        seen.push([
          folderName,
          sayingOf(again).details === sayingOf(first).details ? 1 : 0,
          await devContainersOf(folder).then(each =>
            each.map(each2 => (each2 === containerId ? 'same' : 'new')),
          ),
        ]);
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    deepStrictEqual(seen, [
      ['c52-exits-at-once', 1, ['same']],
      ['c52-restarting', 1, ['same']],
    ]);
  });

  it('F-0409 AC-47 (r47): a window on a workspace file inside a folder with a configuration connects to the folder’s container, and the same container starts again after leaving', async () => {
    const folder = devContainerFolder('c52-workspace-file', {
      name: 'Workspace File',
    });
    const file = path.join(folder, 'one.code-workspace');
    writeFileSync(file, JSON.stringify({folders: [{path: '.'}]}));
    try {
      const first = await openWorkspaceWindow(file);
      await reopenInContainer(first);
      const containerId = await containerOf(folder);
      const label = await docker(
        'inspect',
        '-f',
        '{{index .Config.Labels "devcontainer.local_folder"}}',
        containerId,
      );
      await closeWindow(first);
      await docker('stop', containerId);
      const second = await openWorkspaceWindow(file);
      await reopenInContainer(second);
      deepStrictEqual(
        [
          label,
          await devContainersOf(folder),
          await docker('inspect', '-f', '{{.State.Status}}', containerId),
        ],
        [folder, [containerId], 'running'],
      );
      await closeWindow(second);
    } finally {
      await removeContainers(folder);
    }
  });
});
