import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reloadingCommand,
  reloadWindow,
  reopenInContainer,
  recentlyOpenedIn,
  reopenStarted,
  startInWindow,
  runLabelArguments,
  connectedToContainer,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerNotification,
  chooseQuickPickItem,
  dialogOf,
  pressEscape,
  type ShownDialog,
  statusItem,
  waitForDialog,
  windowTitle,
  notificationCentre,
  notifications,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {paletteItems} from '../windows/palette.ts';
import {noDaemonDocker} from './resolve-support.ts';
import {
  activations,
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** What `docker inspect` says of a container. */
interface Inspected {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  labels: Record<string, string>;
}

/** What `docker inspect` says of container `containerId`: its full id, name, status, start time and labels. */
async function inspectOf(containerId: string): Promise<Inspected> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.StartedAt}}|{{json .Config.Labels}}',
    containerId,
  ]);
  const [fullId = '', name = '', status = '', startedAt = '', ...labels] =
    stdout.trim().split('|');
  return {
    id: fullId,
    name,
    status,
    startedAt,
    labels: JSON.parse(labels.join('|')) as Record<string, string>,
  };
}

/** The one container of the run made for `folder`; it fails naming them when there isn't exactly one. */
async function containerOf(folder: string): Promise<string> {
  const containerIds = await devContainersOf(folder);
  deepStrictEqual(
    containerIds.length,
    1,
    `the containers of ${folder}: ${JSON.stringify(containerIds)}`,
  );
  return containerIds[0] ?? '';
}

/** Opens a local window on `folder`, reopens it in its container, and gives the window's name. */
async function reopened(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  return name;
}

/** Reopens `folder` in its container, closes the window, and gives the container it made. */
async function containerLeftBy(folder: string): Promise<string> {
  const name = await reopened(folder);
  const containerId = await containerOf(folder);
  await closeWindow(name);
  return containerId;
}

/** The Dev Containers items that the palette of window `name` lists for Rebuild. */
async function rebuildItems(name: string): Promise<string[]> {
  return (await paletteItems(name, 'Rebuild')).filter(item =>
    item.startsWith('Dev Containers: Rebuild'),
  );
}

/** The payload and the in-container path that a dev container window's folder URI carries in its authority and path. */
function identityOf(folderUri: string): {payload: unknown; path: string} {
  const match = /^vscode-remote:\/\/dev-container%2B([0-9a-f]+)(\/.*)$/.exec(
    folderUri,
  );
  return {
    payload: JSON.parse(
      Buffer.from(match?.[1] ?? '', 'hex').toString('utf8'),
    ) as unknown,
    path: decodeURIComponent(match?.[2] ?? ''),
  };
}

/**
 * The Open Recent entries of the dev container window of `folder`, whose in-container folder is `/workspaces/<folder
 * name>`, as window `name` reads the editor's list.
 */
async function recentEntriesOf(name: string, folder: string) {
  return (await recentlyOpenedIn(name)).filter(
    entry =>
      entry.remoteAuthority?.startsWith('dev-container+') === true &&
      entry.uri.endsWith(`/workspaces/${path.basename(folder)}`),
  );
}

/** The label the entry of `folder` stores: its host path, with the home folder as ~, and the static suffix. */
function storedLabelOf(folder: string): string {
  const home = os.homedir();
  const shown = folder.startsWith(`${home}/`)
    ? `~${folder.slice(home.length)}`
    : folder;
  return `${shown} [Dev Container]`;
}

/** F-0410's dialog details for a generic failure and for a missing docker, as `failure-strings.ts` has them. */
/** F-0410's detail for a mount Docker refuses (S018), as `failure-strings.ts` has it. */
const S018 =
  'A mount config is invalid. Make sure it has the right format and a source folder that exists on the machine where the Docker daemon is running.';

const S034 = 'An error occurred setting up the container.';
const S339 =
  "The 'docker' command was not found. Make sure Docker is installed.";

/** F-0410's three buttons, sorted. */
const RECOVERY_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** The dialog of a failed connect takes the build or the second check, after the reload. */
const DIALOG_MILLISECONDS = 180_000;

/** The start of the message of F-0402's reopen notification. */
const REOPEN_NOTICE = 'Folder contains a Dev Container configuration file.';

/** Whether container `containerId` mounts something at `/vscode`, the cache volume (F-0419). */
async function vscodeMounted(containerId: string): Promise<boolean> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{json .Mounts}}',
    containerId,
  ]);
  return (JSON.parse(stdout) as Array<{Destination: string}>).some(
    mount => mount.Destination === '/vscode',
  );
}

/**
 * Runs `command`, a rebuild, in the connected window `name` with `dev.containers.dockerPath` naming no program, and
 * gives the dialog that shows after the reload and the remote indicator's text while it shows.
 */
async function rebuiltWithoutDocker(
  name: string,
  command: string,
): Promise<{dialog: ShownDialog; indicator: string}> {
  await setUserSetting('dev.containers.dockerPath', '/nonexistent/docker');
  try {
    await reloadingCommand(name, command);
    const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
    return {dialog, indicator: (await statusItem(name, 'status.host')).text};
  } finally {
    await setUserSetting('dev.containers.dockerPath', undefined);
  }
}

/** Unpauses container `containerId`; a container that is not paused, or is gone, is not a failure. */
async function unpaused(containerId: string): Promise<void> {
  try {
    await execFileAsync('docker', ['unpause', containerId]);
  } catch {
    // the row's own assertions say what state the container was left in
  }
}

/** Opens a local window on `folder`, reopens it in its container, and gives the window and the dialog that shows. */
async function failedWindowOf(
  folder: string,
): Promise<{name: string; dialog: ShownDialog}> {
  const name = await openFolderWindow(folder);
  await reopenStarted(name);
  return {name, dialog: await waitForDialog(name, DIALOG_MILLISECONDS)};
}

/** Answers `label` on the dialog of window `name`, waits for the reload it causes, and gives the dialog that shows next. */
async function nextDialogAfter(
  name: string,
  label: string,
): Promise<ShownDialog> {
  const before = activations(name);
  await answerDialog(name, label);
  await waitFor(
    `window ${name} to activate again`,
    () => activations(name) > before,
    60_000,
  );
  return waitForDialog(name, DIALOG_MILLISECONDS);
}

/** A dialog as the rows compare it: its message, its detail and its buttons in sorted order. */
function dialogText(dialog: ShownDialog): [string, string, string[]] {
  return [dialog.message, dialog.details, [...dialog.buttons].sort()];
}

/**
 * In a local window on `folder`, whose container `containerId` exists, runs Rebuild and Reopen in Container with
 * `dev.containers.dockerPath` set to `dockerPath`, answers its dialog with Cancel, and gives the dialog, the window's
 * remote name and the folder's containers after it.
 */
async function rebuildCancelled(
  folder: string,
  dockerPath: string,
): Promise<{
  dialog: [string, string, string[]];
  remoteName: string | null;
  containers: string[];
}> {
  await setUserSetting('dev.containers.dockerPath', dockerPath);
  try {
    const name = await openFolderWindow(folder);
    // The command waits on its dialog, so it's answered before the command is awaited.
    const running = inWindow(
      name,
      'remote-containers.rebuildAndReopenInContainer',
    );
    const dialog = await waitForDialog(name);
    await answerDialog(name, 'Cancel');
    await running;
    const outcome = {
      dialog: dialogText(dialog),
      remoteName: (await windowState(name)).remoteName,
      containers: await devContainersOf(folder),
    };
    await closeWindow(name);
    return outcome;
  } finally {
    await setUserSetting('dev.containers.dockerPath', undefined);
  }
}

describe('the remaining Dev Containers gate rows (card containers-19)', function () {
  this.timeout(900_000);

  it('F-0409 AC-1, AC-3 (gate-row-3): a folder gets one new container with a generated name and the folder labels, and the next Reopen reuses it while it runs', async () => {
    const folder = devContainerFolder('reuse-same', {name: 'Reuse'});
    try {
      const created = await inspectOf(await containerLeftBy(folder));
      const second = await reopened(folder);
      const containerIds = await devContainersOf(folder);
      const reused = await inspectOf(containerIds[0] ?? '');
      await closeWindow(second);
      deepStrictEqual(
        {
          generatedName: !['/', `/${path.basename(folder)}`].includes(
            created.name,
          ),
          labels: [
            created.labels['devcontainer.local_folder'],
            created.labels['devcontainer.config_file'],
          ],
          containers: containerIds.length,
          sameId: reused.id === created.id,
          startedAt: reused.startedAt,
        },
        {
          generatedName: true,
          labels: [
            folder,
            path.join(folder, '.devcontainer', 'devcontainer.json'),
          ],
          containers: 1,
          sameId: true,
          startedAt: created.startedAt,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-13, F-0409 AC-2 (gate-row-4): a stopped container is started again with the same id, with no image build and a Starting container step in the log, its postCreateCommand not run again and its postStartCommand run, and no dialog shows', async () => {
    const folder = devContainerFolder('reuse-stopped', {
      postCreateCommand: 'echo create >> /tmp/c58-runs',
      postStartCommand: 'echo start >> /tmp/c58-runs',
    });
    try {
      const stopped = await inspectOf(await containerLeftBy(folder));
      await execFileAsync('docker', ['stop', stopped.id]);
      const mark = containersLog().length;
      const name = await reopened(folder);
      const dialog = await dialogOf(name);
      const lines = containersLogSince(mark);
      const containerIds = await devContainersOf(folder);
      const started = await inspectOf(containerIds[0] ?? '');
      const {stdout: runs} = await execFileAsync('docker', [
        'exec',
        started.id,
        'cat',
        '/tmp/c58-runs',
      ]);
      await closeWindow(name);
      deepStrictEqual(
        {
          containers: containerIds.length,
          sameId: started.id === stopped.id,
          status: started.status,
          later: started.startedAt > stopped.startedAt,
          dialog,
          builds: lines.filter(line => /^#\d+ /.test(line)),
          startingStep: lines.includes('Starting container'),
          runs: runs.trim().split('\n'),
        },
        {
          containers: 1,
          sameId: true,
          status: 'running',
          later: true,
          dialog: undefined,
          builds: [],
          startingStep: true,
          runs: ['create', 'start', 'start'],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-6 (r4b): a container removed outside the editor is made again silently, with a new id', async () => {
    const folder = devContainerFolder('reuse-removed');
    try {
      const removed = await containerLeftBy(folder);
      await execFileAsync('docker', ['rm', '-f', removed]);
      const name = await openFolderWindow(folder);
      const shown: ShownDialog[] = [];
      const watch = {connected: false};
      const polling = (async () => {
        while (!watch.connected) {
          // A window that reloads into its container has no page for a moment; that's no dialog.
          const dialog = await dialogOf(name).catch(() => undefined);
          if (dialog !== undefined) {
            shown.push(dialog);
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      })();
      await reopenInContainer(name);
      watch.connected = true;
      await polling;
      const containerIds = await devContainersOf(folder);
      const remoteName = (await windowState(name)).remoteName;
      await closeWindow(name);
      deepStrictEqual(
        {
          containers: containerIds.length,
          newId: containerIds[0] !== removed,
          remoteName,
          shown,
        },
        {containers: 1, newId: true, remoteName: 'dev-container', shown: []},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0412 AC-41 (t41): the image tags of folders with odd names are the pinned CLI’s, and Docker accepts each', async () => {
    const cases = [
      {
        folder: '.f412x-_a..b___c_.d',
        image: /^vsc-f412x-a\.b__c_d-[0-9a-f]{64}$/,
      },
      {folder: 'f412end.', image: /^vsc-f412end\.[0-9a-f]{64}$/},
      {folder: '-f412lead', image: /^vsc--f412lead-[0-9a-f]{64}$/},
    ];
    const folders = cases.map(each => {
      const folder = devContainerFolder(each.folder, {
        image: undefined,
        build: {dockerfile: 'Dockerfile'},
      });
      writeFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`,
      );
      return folder;
    });
    try {
      for (const folder of folders) {
        await closeWindow(await reopened(folder));
      }
      const {stdout} = await execFileAsync('docker', [
        'images',
        '--format',
        '{{.Repository}}',
      ]);
      const repositories = stdout.split('\n');
      console.log(
        `containers-19 T41: the vsc- images: ${JSON.stringify(repositories.filter(each => each.includes('f412')))}`,
      );
      deepStrictEqual(
        cases.map(each =>
          repositories.some(repository => each.image.test(repository)),
        ),
        [true, true, true],
      );
    } finally {
      for (const folder of folders) {
        await removeContainers(folder);
      }
    }
  });
  it('F-0405 AC-25 (b25): a rebuild whose Dockerfile fails shows F-0410’s dialog, leaves no container, and More Actions... offers its four items', async () => {
    const folder = devContainerFolder('rebuild-fails', {
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    const dockerfile = path.join(folder, '.devcontainer', 'Dockerfile');
    const from = `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`;
    writeFileSync(dockerfile, from);
    try {
      const name = await reopened(folder);
      writeFileSync(dockerfile, `${from}RUN false\n`);
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const containers = await devContainersOf(folder);
      await answerDialog(name, 'More Actions...');
      const pick = await waitForQuickPick(name, 30_000);
      await closeWindow(name);
      deepStrictEqual(
        {
          details: dialog.details,
          buttons: [...dialog.buttons].sort(),
          containers,
          items: pick.items,
        },
        {
          details: S034,
          buttons: RECOVERY_BUTTONS,
          containers: [],
          items: [
            'Reload Window',
            'Edit devcontainer.json Locally',
            'Open Recent...',
            'Open Documentation',
          ],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-26 (b26): a rebuild with a docker that does not exist shows S339 with F-0410’s buttons, and the container keeps its id, a recorded deviation (athena on #939, remote-oss/remote-containers#123)', async () => {
    const folder = devContainerFolder('rebuild-docker');
    try {
      const name = await reopened(folder);
      const kept = await containerOf(folder);
      const {dialog} = await rebuiltWithoutDocker(
        name,
        'remote-containers.rebuildContainer',
      );
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {
          details: dialog.details,
          buttons: [...dialog.buttons].sort(),
          containers,
        },
        {details: S339, buttons: RECOVERY_BUTTONS, containers: [kept]},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0201 AC-50 (b50): Rebuild Without Cache with a docker that does not exist shows S339 while the indicator says Opening Remote..., and the container keeps its id', async () => {
    const folder = devContainerFolder('rebuild-docker-nocache');
    try {
      const name = await reopened(folder);
      const kept = await containerOf(folder);
      const {dialog, indicator} = await rebuiltWithoutDocker(
        name,
        'remote-containers.rebuildContainerNoCache',
      );
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {
          details: dialog.details,
          buttons: [...dialog.buttons].sort(),
          indicator,
          containers,
        },
        {
          details: S339,
          buttons: RECOVERY_BUTTONS,
          indicator: 'Opening Remote...',
          containers: [kept],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0419 AC-9 (v9): with cacheVolume turned off, a reload keeps the mounted container, and a rebuild makes a new one without the vscode volume', async () => {
    const folder = devContainerFolder('cache-toggle');
    await setUserSetting('dev.containers.cacheVolume', true);
    try {
      const name = await reopened(folder);
      const first = await containerOf(folder);
      const mountedFirst = await vscodeMounted(first);
      await setUserSetting('dev.containers.cacheVolume', false);
      await reloadWindow(name);
      const afterReload = await devContainersOf(folder);
      const mountedAfterReload = await vscodeMounted(first);
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      let rebuilt = '';
      await waitFor(
        'the rebuild to make a new container',
        async () => {
          const containerIds = await devContainersOf(folder);
          rebuilt = containerIds.find(each => each !== first) ?? '';
          return rebuilt !== '' && containerIds.length === 1;
        },
        DIALOG_MILLISECONDS,
      );
      const mountedRebuilt = await vscodeMounted(rebuilt);
      await closeWindow(name);
      deepStrictEqual(
        {mountedFirst, afterReload, mountedAfterReload, mountedRebuilt},
        {
          mountedFirst: true,
          afterReload: [first],
          mountedAfterReload: true,
          mountedRebuilt: false,
        },
      );
    } finally {
      await setUserSetting('dev.containers.cacheVolume', undefined);
      await removeContainers(folder);
    }
  });

  it('F-0419 AC-30 (cache-zero): with the number 0 for dev.containers.cacheVolume, the new container has no mount at /vscode', async () => {
    const folder = devContainerFolder('cache-zero');
    await setUserSetting('dev.containers.cacheVolume', 0);
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      await closeWindow(name);
      deepStrictEqual(await vscodeMounted(containerId), false);
    } finally {
      await setUserSetting('dev.containers.cacheVolume', undefined);
      await removeContainers(folder);
    }
  });

  it('F-0419 AC-30 (cache-string-false): with the string "false" for dev.containers.cacheVolume, the new container mounts the vscode volume at /vscode', async () => {
    const folder = devContainerFolder('cache-string-false');
    await setUserSetting('dev.containers.cacheVolume', 'false');
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      await closeWindow(name);
      deepStrictEqual(await vscodeMounted(containerId), true);
    } finally {
      await setUserSetting('dev.containers.cacheVolume', undefined);
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-26 (b26b): in a local window with a missing docker, Rebuild and Reopen shows the engine dialog, and Cancel keeps the container', async () => {
    const folder = devContainerFolder('rebuild-local');
    try {
      const kept = await containerLeftBy(folder);
      const missing = '/nonexistent/docker';
      deepStrictEqual(await rebuildCancelled(folder, missing), {
        dialog: [
          'Docker version 17.12.0 or later required.',
          `Command not found: '${missing}'. Check the license for details.`,
          ['Cancel', 'Install', 'License'],
        ],
        remoteName: null,
        containers: [kept],
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-26 (b26c): in a local window whose docker reaches no daemon, Rebuild and Reopen shows the engine error, and Cancel keeps the container', async () => {
    const folder = devContainerFolder('rebuild-daemon');
    try {
      const kept = await containerLeftBy(folder);
      const wrapper = noDaemonDocker();
      deepStrictEqual(await rebuildCancelled(folder, wrapper), {
        dialog: [
          'Docker returned an error.',
          'Make sure the Docker daemon is running.',
          ['Cancel', 'Show Log'],
        ],
        remoteName: null,
        containers: [kept],
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-7 (p7): a paused container shows F-0410\'s generic dialog after the reload, and no "Container is paused." text', async () => {
    const folder = devContainerFolder('c46-paused', {name: 'Paused'});
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['pause', containerId]);
      const name = await openFolderWindow(folder);
      try {
        await reopenStarted(name);
        const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
        deepStrictEqual(
          {
            dialog: dialogText(dialog),
            title: await windowTitle(name),
            indicator: (await statusItem(name, 'status.host')).text,
            containers: await devContainersOf(folder),
            status: (await inspectOf(containerId)).status,
          },
          {
            dialog: ['', S034, RECOVERY_BUTTONS],
            title: '[c46-paused [Dev Container: Paused]]',
            indicator: 'Opening Remote...',
            containers: [containerId],
            status: 'paused',
          },
        );
        await closeWindow(name);
      } finally {
        await execFileAsync('docker', ['unpause', containerId]).catch(
          () => undefined,
        );
      }
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-26 (p26): a container made from an older configuration is reused, without the new containerEnv, under the new name', async () => {
    const folder = devContainerFolder('c46-older', {name: 'Old Name'});
    try {
      const containerId = await containerLeftBy(folder);
      writeFileSync(
        path.join(folder, '.devcontainer', 'devcontainer.json'),
        JSON.stringify({
          image: variable('HARNESS_DEVCONTAINER_IMAGE'),
          runArgs: runLabelArguments(),
          name: 'New Name',
          // eslint-disable-next-line id-length -- the card names the variable C46
          containerEnv: {C46: 'yes'},
        }),
      );
      await execFileAsync('docker', ['stop', containerId]);
      const name = await reopened(folder);
      const {stdout: env} = await execFileAsync('docker', [
        'exec',
        containerId,
        'sh',
        '-c',
        'echo "C46=$C46"',
      ]);
      deepStrictEqual(
        {
          containers: await devContainersOf(folder),
          title: await windowTitle(name),
          indicator: (await statusItem(name, 'status.host')).text,
          env,
        },
        {
          containers: [containerId],
          title: '[c46-older [Dev Container: New Name]]',
          indicator: 'Dev Container: New Name',
          env: 'C46=\n',
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-44 (p44): Retry while the bind source is still missing shows the same dialog, and the container stays exited', async () => {
    const source = path.join(variable('HARNESS_RUN_FOLDER'), 'c46-bind-src');
    mkdirSync(source, {recursive: true});
    const folder = devContainerFolder('c46-bind', {
      name: 'Bind',
      mounts: [`source=${source},target=/bind,type=bind`],
    });
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['stop', containerId]);
      rmSync(source, {recursive: true, force: true});
      const name = await openFolderWindow(folder);
      try {
        await reopenStarted(name);
        const first = await waitForDialog(name, DIALOG_MILLISECONDS);
        await answerDialog(name, 'Retry');
        const second = await waitForDialog(name, DIALOG_MILLISECONDS);
        deepStrictEqual(
          {
            first: dialogText(first),
            second: dialogText(second),
            containers: await devContainersOf(folder),
            status: (await inspectOf(containerId)).status,
          },
          {
            first: ['', S018, RECOVERY_BUTTONS],
            second: ['', S018, RECOVERY_BUTTONS],
            containers: [containerId],
            status: 'exited',
          },
        );
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    } finally {
      rmSync(source, {recursive: true, force: true});
    }
  });

  it('F-0409 AC-35 (p35): with the bind source restored, Retry connects to the same container, with its bind mount', async () => {
    const source = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c46-bind-back-src',
    );
    mkdirSync(source, {recursive: true});
    const folder = devContainerFolder('c46-bind-back', {
      name: 'Bind',
      mounts: [`source=${source},target=/bind,type=bind`],
    });
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['stop', containerId]);
      rmSync(source, {recursive: true, force: true});
      const name = await openFolderWindow(folder);
      try {
        await reopenStarted(name);
        const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
        const dialogTexts = dialogText(dialog);
        mkdirSync(source, {recursive: true});
        await answerDialog(name, 'Retry');
        await connectedToContainer(name, DIALOG_MILLISECONDS);
        const {stdout: mounts} = await execFileAsync('docker', [
          'inspect',
          '-f',
          '{{json .Mounts}}',
          containerId,
        ]);
        const mount = (
          JSON.parse(mounts) as Array<{
            Type: string;
            Source: string;
            Destination: string;
          }>
        ).find(each => each.Destination === '/bind');
        deepStrictEqual(
          {
            dialog: dialogTexts,
            containers: await devContainersOf(folder),
            status: (await inspectOf(containerId)).status,
            mount:
              mount === undefined
                ? undefined
                : [mount.Type, mount.Source, mount.Destination],
          },
          {
            dialog: ['', S018, RECOVERY_BUTTONS],
            containers: [containerId],
            status: 'running',
            mount: ['bind', source, '/bind'],
          },
        );
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    } finally {
      rmSync(source, {recursive: true, force: true});
    }
  });

  it("F-0409 AC-34 (p34): the dialog half, an exited container whose bind source is gone is started, Docker's refusal shows S018, and no container is made", async () => {
    const source = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c46-bind-gone-src',
    );
    mkdirSync(source, {recursive: true});
    const folder = devContainerFolder('c46-bind-gone', {
      name: 'Bind',
      mounts: [`source=${source},target=/bind,type=bind`],
    });
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['stop', containerId]);
      rmSync(source, {recursive: true, force: true});
      const name = await openFolderWindow(folder);
      try {
        await reopenStarted(name);
        const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
        deepStrictEqual(
          {
            dialog: dialogText(dialog),
            containers: await devContainersOf(folder),
          },
          {dialog: ['', S018, RECOVERY_BUTTONS], containers: [containerId]},
        );
        await answerDialog(name, 'More Actions...');
        const quickPick = await waitForQuickPick(name, 30_000);
        console.log(
          `containers-46 p34: the pick's items: ${JSON.stringify(quickPick.items)}`,
        );
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    } finally {
      rmSync(source, {recursive: true, force: true});
    }
  });

  it('F-0408 AC-13, F-0409 AC-45 (p45): reopening an exited container shows no build phase, only the connecting toast and its server stage', async () => {
    const folder = devContainerFolder('c46-exited');
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['stop', containerId]);
      const name = await openFolderWindow(folder);
      try {
        const texts: string[] = [];
        const gate = {done: false};
        const sampler = (async () => {
          while (!gate.done) {
            try {
              texts.push(...(await notifications(name)));
            } catch {
              // The window is reloading.
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        })();
        await reopenInContainer(name);
        gate.done = true;
        await sampler;
        const connecting = texts.filter(text =>
          text.startsWith('Connecting to Dev Container'),
        );
        deepStrictEqual(
          {
            seen: connecting.length > 0,
            offStage: connecting.filter(
              text =>
                ![
                  'Connecting to Dev Container (show log)',
                  'Connecting to Dev Container (show log): Starting server',
                ].includes(text),
            ),
            containers: await devContainersOf(folder),
          },
          {
            seen: true,
            offStage: [],
            containers: [containerId],
          },
        );
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    } finally {
      await removeContainers(folder);
    }
  });

  it("F-0409 AC-4 (ruling-13): the labels name the folder and the configuration, and the metadata label is the CLI's", async () => {
    const folder = devContainerFolder('c46-labels', {name: 'Labels'});
    try {
      const containerId = await containerLeftBy(folder);
      const labels = (await inspectOf(containerId)).labels;
      deepStrictEqual(
        {
          localFolder: labels['devcontainer.local_folder'],
          configFile: labels['devcontainer.config_file'],
          metadataIsArray: Array.isArray(
            JSON.parse(labels['devcontainer.metadata'] ?? 'null'),
          ),
          vscodeLabels: Object.keys(labels).filter(key =>
            key.startsWith('vsch.'),
          ),
        },
        {
          localFolder: folder,
          configFile: path.join(folder, '.devcontainer', 'devcontainer.json'),
          metadataIsArray: true,
          vscodeLabels: [],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it("F-0409 AC-22 (p22): Retry on the paused container's dialog connects to the same container, now running", async () => {
    const folder = devContainerFolder('c47-paused-retry', {name: 'Paused'});
    let containerId: string | undefined;
    try {
      containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['pause', containerId]);
      const {name} = await failedWindowOf(folder);
      await answerDialog(name, 'Retry');
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      const containers = await devContainersOf(folder);
      const {status} = await inspectOf(containerId);
      await closeWindow(name);
      deepStrictEqual(
        {containers, status},
        {containers: [containerId], status: 'running'},
      );
    } finally {
      if (containerId !== undefined) {
        await unpaused(containerId);
      }
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-7 (p7b): by ruling 12, without Retry, a second reload of a paused container fails again and leaves it paused', async () => {
    const folder = devContainerFolder('c47-paused-reload', {name: 'Paused'});
    let containerId: string | undefined;
    try {
      containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['pause', containerId]);
      const {name, dialog} = await failedWindowOf(folder);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      await pressEscape(name);
      await reloadWindow(name);
      const again = await waitForDialog(name, DIALOG_MILLISECONDS);
      const {status} = await inspectOf(containerId);
      await closeWindow(name);
      deepStrictEqual(
        {first: dialogText(dialog), again: dialogText(again), status},
        {
          first: ['', S034, RECOVERY_BUTTONS],
          again: ['', S034, RECOVERY_BUTTONS],
          status: 'paused',
        },
      );
    } finally {
      if (containerId !== undefined) {
        await unpaused(containerId);
      }
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-34, F-0410 AC-6, AC-11b (p34b): More Actions... offers Rebuild Container when the container exists, Retry keeps the same container, and Rebuild connects the window to a new one', async () => {
    const source = path.join(variable('HARNESS_RUN_FOLDER'), 'c47-bind-src');
    mkdirSync(source, {recursive: true});
    const folder = devContainerFolder('c47-rebuild-item', {
      name: 'Rebuildable',
      mounts: [`source=${source},target=/bind,type=bind`],
    });
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['stop', containerId]);
      rmSync(source, {recursive: true, force: true});
      writeFileSync(
        path.join(folder, '.devcontainer', 'devcontainer.json'),
        JSON.stringify({
          image: variable('HARNESS_DEVCONTAINER_IMAGE'),
          runArgs: runLabelArguments(),
          name: 'Rebuildable',
        }),
      );
      const {name, dialog} = await failedWindowOf(folder);
      const title = await windowTitle(name);
      const again = await nextDialogAfter(name, 'Retry');
      const kept = {
        containers: await devContainersOf(folder),
        status: (await inspectOf(containerId)).status,
      };
      await answerDialog(name, 'More Actions...');
      const pick = await waitForQuickPick(name, 30_000);
      await chooseQuickPickItem(name, 'Rebuild Container');
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      const rebuilt = await devContainersOf(folder);
      const {stdout: leftover} = await execFileAsync('docker', [
        'ps',
        '--all',
        '--quiet',
        '--filter',
        `id=${containerId}`,
      ]);
      await closeWindow(name);
      deepStrictEqual(
        {
          first: dialogText(dialog),
          title: title.startsWith(
            '[c47-rebuild-item [Dev Container: Rebuildable]]',
          ),
          again: dialogText(again),
          kept,
          items: pick.items,
          rebuiltAnew: rebuilt.length === 1 && rebuilt[0] !== containerId,
          oldGone: leftover.trim(),
        },
        {
          first: ['', S018, RECOVERY_BUTTONS],
          title: true,
          again: ['', S018, RECOVERY_BUTTONS],
          kept: {containers: [containerId], status: 'exited'},
          items: [
            'Reload Window',
            'Rebuild Container',
            'Edit devcontainer.json Locally',
            'Open Recent...',
            'Open Documentation',
          ],
          rebuiltAnew: true,
          oldGone: '',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-34 (p34c): the first failure of a container this connect made offers Rebuild Container too', async () => {
    const folder = devContainerFolder('c47-created-fails', {
      name: 'Created Fails',
      containerUser: 'doesnotexist123',
    });
    try {
      const {name, dialog} = await failedWindowOf(folder);
      const containers = await devContainersOf(folder);
      await answerDialog(name, 'More Actions...');
      const pick = await waitForQuickPick(name, 30_000);
      await closeWindow(name);
      deepStrictEqual(
        {
          buttons: dialogText(dialog)[2],
          containers: containers.length,
          items: pick.items,
        },
        {
          buttons: RECOVERY_BUTTONS,
          containers: 1,
          items: [
            'Reload Window',
            'Rebuild Container',
            'Edit devcontainer.json Locally',
            'Open Recent...',
            'Open Documentation',
          ],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-12 (r12): a stopped container whose configuration was edited is restarted as it is from the reopen notification: same id, the edit not applied, and no configuration-change notice', async () => {
    const folder = devContainerFolder('c54-stopped-edit', {
      name: 'Stopped Edit',
    });
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['stop', containerId]);
      writeFileSync(
        path.join(folder, '.devcontainer', 'devcontainer.json'),
        JSON.stringify({
          image: variable('HARNESS_DEVCONTAINER_IMAGE'),
          runArgs: runLabelArguments(),
          name: 'Stopped Edit',
          containerEnv: {C54_EDITED: 'yes'},
        }),
      );
      const name = await openFolderWindow(folder);
      await waitFor(
        `the reopen notification in window ${name}`,
        async () => {
          try {
            return (await notificationCentre(name)).some(text =>
              text.startsWith(REOPEN_NOTICE),
            );
          } catch {
            return false;
          }
        },
        30_000,
      );
      await answerNotification(name, REOPEN_NOTICE, 'Reopen in Container');
      await waitFor(
        `container ${containerId} to be running again`,
        async () => (await inspectOf(containerId)).status === 'running',
        DIALOG_MILLISECONDS,
      );
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      const containers = await devContainersOf(folder);
      const {stdout: environment} = await execFileAsync('docker', [
        'exec',
        containerId,
        'sh',
        '-c',
        'echo "edited=${C54_EDITED:-}"',
      ]);
      const centre = await notificationCentre(name);
      await closeWindow(name);
      deepStrictEqual(
        {
          containers: containers.map(shortId =>
            containerId.startsWith(shortId),
          ),
          environment: environment.trim(),
          changed: centre.filter(text => /changed|Rebuild/.test(text)),
        },
        {containers: [true], environment: 'edited=', changed: []},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-19 (r19): Rebuild Container in More Actions... replaces the container a failed start left created, by a fresh one', async () => {
    const folder = devContainerFolder('c54-created-rebuild', {
      name: 'Created Rebuild',
      containerUser: 'doesnotexist123',
    });
    try {
      const {name} = await failedWindowOf(folder);
      const [first = ''] = await devContainersOf(folder);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      const before = activations(name);
      await chooseQuickPickItem(name, 'Rebuild Container');
      await waitFor(
        `window ${name} to activate again`,
        () => activations(name) > before,
        60_000,
      );
      const again = await waitForDialog(name, DIALOG_MILLISECONDS);
      const second = await devContainersOf(folder);
      const {stdout: firstLeft} = await execFileAsync('docker', [
        'ps',
        '--all',
        '--quiet',
        '--filter',
        `id=${first}`,
      ]);
      await closeWindow(name);
      deepStrictEqual(
        {
          created: first !== '',
          dialog: dialogText(again),
          replaced: second.length === 1 && second[0] !== first,
          firstGone: firstLeft.trim(),
        },
        {
          created: true,
          dialog: ['', S034, RECOVERY_BUTTONS],
          replaced: true,
          firstGone: '',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-31 (r31): Rebuild Container on a connected window whose configuration names no container source shows F-0410’s dialog or the missing-image warning, creates no container, and keeps the old one', async () => {
    const folder = devContainerFolder('c54-rebuild-no-source', {
      name: 'Rebuild No Source',
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      writeFileSync(
        path.join(folder, '.devcontainer', 'devcontainer.json'),
        JSON.stringify({name: 'Rebuild No Source'}),
      );
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const containers = await devContainersOf(folder);
      const {status} = await inspectOf(containerId);
      await closeWindow(name);
      deepStrictEqual(
        {
          dialog: dialogText(dialog),
          containers: containers.map(shortId =>
            containerId.startsWith(shortId),
          ),
          status,
        },
        {
          dialog: ['', S034, RECOVERY_BUTTONS],
          containers: [true],
          status: 'running',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-17 (r17): an anonymous volume mount is backed by a new empty volume after a rebuild, and the old one stays on the host unreferenced', async () => {
    const folder = devContainerFolder('c54-anonymous', {
      name: 'Anonymous',
      mounts: ['type=volume,target=/c54anon'],
    });
    const volumes: string[] = [];
    try {
      const name = await reopened(folder);
      const first = await containerOf(folder);
      await execFileAsync('docker', [
        'exec',
        first,
        'sh',
        '-c',
        'echo kept > /c54anon/marker',
      ]);
      async function volumeOf(containerId: string): Promise<string> {
        const {stdout} = await execFileAsync('docker', [
          'inspect',
          '-f',
          '{{range .Mounts}}{{if eq .Destination "/c54anon"}}{{.Name}}{{end}}{{end}}',
          containerId,
        ]);
        return stdout.trim();
      }
      const oldVolume = await volumeOf(first);
      volumes.push(oldVolume);
      await reopenInContainer(
        name,
        DIALOG_MILLISECONDS,
        'remote-containers.rebuildContainer',
      );
      const second = await containerOf(folder);
      const newVolume = await volumeOf(second);
      volumes.push(newVolume);
      const {stdout: marker} = await execFileAsync('docker', [
        'exec',
        second,
        'sh',
        '-c',
        'cat /c54anon/marker 2>/dev/null || echo none',
      ]);
      const {stdout: listed} = await execFileAsync('docker', [
        'volume',
        'ls',
        '--quiet',
        '--filter',
        `name=${oldVolume}`,
        '--filter',
        'dangling=true',
      ]);
      await closeWindow(name);
      deepStrictEqual(
        {
          replaced: first !== second,
          newVolume: newVolume !== '' && newVolume !== oldVolume,
          marker: marker.trim(),
          oldDangling: listed.trim() === oldVolume,
        },
        {replaced: true, newVolume: true, marker: 'none', oldDangling: true},
      );
    } finally {
      await removeContainers(folder);
      for (const volume of volumes.filter(each => each !== '')) {
        await execFileAsync('docker', ['volume', 'rm', '--force', volume]);
      }
    }
  });

  it('F-0405 AC-10 (r10): a failing postCreateCommand on a rebuild leaves a connected window with no notification or dialog, skips postStartCommand, and the log names the command, its exit code and the skip', async () => {
    const folder = devContainerFolder('c54-rebuild-poststart', {
      name: 'Rebuild Poststart',
      postCreateCommand: 'exit 7',
      postStartCommand: 'touch /tmp/c54-poststart',
    });
    try {
      const name = await reopened(folder);
      const mark = containersLog().length;
      await reopenInContainer(
        name,
        DIALOG_MILLISECONDS,
        'remote-containers.rebuildContainer',
      );
      await new Promise(resolve => setTimeout(resolve, 15_000));
      const containerId = await containerOf(folder);
      const {stdout: started} = await execFileAsync('docker', [
        'exec',
        containerId,
        'sh',
        '-c',
        'test -e /tmp/c54-poststart && echo yes || echo no',
      ]);
      const lines = containersLogSince(mark).filter(
        line => line.includes('postCreateCommand') && line.includes('failed'),
      );
      const centre = await notificationCentre(name);
      const dialog = await dialogOf(name);
      await closeWindow(name);
      deepStrictEqual(
        {
          started: started.trim(),
          lines,
          centre,
          dialog,
        },
        {
          started: 'no',
          lines: [
            'postCreateCommand from devcontainer.json failed with exit code 7. Skipping any further user-provided commands.',
            'the lifecycle commands failed: lifecycleFailed (postCreateCommand)',
          ],
          centre: [],
          dialog: undefined,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0501 AC-2 (r2): a configuration with no name gives the plain suffix in the title and the indicator', async () => {
    const folder = devContainerFolder('c54-no-name', {name: undefined});
    try {
      const name = await reopened(folder);
      const title = await windowTitle(name);
      const indicator = (await statusItem(name, 'status.host')).text;
      await closeWindow(name);
      deepStrictEqual(
        {
          title: title.startsWith('[c54-no-name [Dev Container]]'),
          indicator,
        },
        {title: true, indicator: 'Dev Container'},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0504 AC-15 (r15): the host indicator never reads Connected while the window connects to a container', async () => {
    const folder = devContainerFolder('c54-indicator', {name: 'Indicator'});
    try {
      const name = await openFolderWindow(folder);
      const seen = new Set<string>([
        (await statusItem(name, 'status.host')).text,
      ]);
      const sampling = {done: false};
      const sampler = (async () => {
        while (!sampling.done) {
          try {
            seen.add((await statusItem(name, 'status.host')).text);
          } catch {
            // The window is reloading, or the item is not drawn yet.
          }
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      })();
      await reopenInContainer(name);
      sampling.done = true;
      await sampler;
      seen.add((await statusItem(name, 'status.host')).text);
      await closeWindow(name);
      deepStrictEqual(
        [
          [...seen].some(text =>
            /^\s*(\$\(remote\) )?Connected\s*$/.test(text),
          ),
          seen.size > 1,
        ],
        [false, true],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0401 AC-11 (r11): Reopen in Container on a folder whose container is stopped starts the same container', async () => {
    const folder = devContainerFolder('c54-stopped-reopen', {
      name: 'Stopped Reopen',
    });
    try {
      const containerId = await containerLeftBy(folder);
      await execFileAsync('docker', ['stop', containerId]);
      const name = await reopened(folder);
      const containers = await devContainersOf(folder);
      const {status} = await inspectOf(containerId);
      const title = await windowTitle(name);
      await closeWindow(name);
      deepStrictEqual(
        {
          containers: containers.map(shortId =>
            containerId.startsWith(shortId),
          ),
          status,
          title: title.startsWith(
            '[c54-stopped-reopen [Dev Container: Stopped Reopen]]',
          ),
        },
        {containers: [true], status: 'running', title: true},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0401 AC-20 (r20): two Reopen in Container commands in immediate succession make one container', async () => {
    const folder = devContainerFolder('c54-twice', {name: 'Twice'});
    try {
      const name = await openFolderWindow(folder);
      await startInWindow(name, 'remote-containers.reopenInContainer');
      try {
        await startInWindow(name, 'remote-containers.reopenInContainer');
      } catch {
        // The first command's reload may have ended the agent before it could accept the second.
      }
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(containers.length, 1);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0201 AC-1 (m1): Reopen in Container on a trusted folder with a pre-pulled image shows no dialog, makes the vscode volume, starts the container and connects the same window', async () => {
    const folder = devContainerFolder('c54-first-reopen', {
      name: 'First Reopen',
    });
    try {
      const name = await reopened(folder);
      const {labels, status} = await inspectOf(await containerOf(folder));
      const volumes = (
        await execFileAsync('docker', ['volume', 'ls', '--quiet'])
      ).stdout.split('\n');
      const state = {
        remoteName: (await windowState(name)).remoteName,
        title: (await windowTitle(name)).startsWith(
          '[c54-first-reopen [Dev Container: First Reopen]]',
        ),
        indicator: (await statusItem(name, 'status.host')).text,
        dialog: await dialogOf(name),
        volume: volumes.includes('vscode'),
        status,
        folder: labels['devcontainer.local_folder'],
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        remoteName: 'dev-container',
        title: true,
        indicator: 'Dev Container: First Reopen',
        dialog: undefined,
        volume: true,
        status: 'running',
        folder,
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0501 AC-1 (m2): the connected window’s folder URI carries the host path, localDocker false and the configuration file in its authority, and the title and indicator name the folder and the configuration', async () => {
    const folder = devContainerFolder('c54-identity', {name: 'Identity Name'});
    try {
      const name = await reopened(folder);
      const [uri = ''] = (await windowState(name)).folders;
      const {payload, path: inside} = identityOf(uri);
      const configuration = path.join(
        folder,
        '.devcontainer',
        'devcontainer.json',
      );
      const state = {
        inside,
        payload,
        title: (await windowTitle(name)).startsWith(
          '[c54-identity [Dev Container: Identity Name]]',
        ),
        indicator: (await statusItem(name, 'status.host')).text,
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        inside: '/workspaces/c54-identity',
        payload: {
          hostPath: folder,
          localDocker: false,
          configFile: {
            $mid: 1,
            fsPath: configuration,
            external: `file://${configuration}`,
            path: configuration,
            scheme: 'file',
          },
        },
        title: true,
        indicator: 'Dev Container: Identity Name',
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0501 AC-1 (stored-label): the Open Recent entry of the connected window stores the host path and the static suffix as its label, and the window’s authority as its remote authority', async () => {
    const folder = devContainerFolder('c71-stored', {name: 'Stored Name'});
    try {
      const name = await reopened(folder);
      const entries = await recentEntriesOf(name, folder);
      const authority = entries[0]?.remoteAuthority ?? '';
      await closeWindow(name);
      deepStrictEqual(
        entries.map(entry => [
          entry.label,
          entry.remoteAuthority,
          entry.uri.startsWith(
            `vscode-remote://${authority.replace('+', '%2B')}/`,
          ),
        ]),
        [[storedLabelOf(folder), authority, true]],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0501 AC-8 (rename): renaming the configuration and reconnecting changes the live label and leaves the stored one', async () => {
    const folder = devContainerFolder('c71-rename', {name: 'Old Name'});
    try {
      const first = await reopened(folder);
      const before = await recentEntriesOf(first, folder);
      await closeWindow(first);
      devContainerFolder('c71-rename', {name: 'New Name'});
      const second = await reopened(folder);
      const after = await recentEntriesOf(second, folder);
      const indicator = (await statusItem(second, 'status.host')).text;
      await closeWindow(second);
      deepStrictEqual(
        [
          indicator,
          before.map(entry => entry.label),
          after.map(entry => entry.label),
        ],
        [
          'Dev Container: New Name',
          [storedLabelOf(folder)],
          [storedLabelOf(folder)],
        ],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0501 AC-27 (m3): a host folder whose name has #, ? and % is mounted under its full name, its authority carries the full host path, and the window opens that folder with its full name in the title and no dialog', async () => {
    const folder = devContainerFolder('c54-h #x?%', {name: 'Hash Name'});
    try {
      const name = await reopened(folder);
      const [uri = ''] = (await windowState(name)).folders;
      const {payload, path: inside} = identityOf(uri);
      const {stdout: mounts} = await execFileAsync('docker', [
        'inspect',
        '--format',
        '{{range .Mounts}}{{if eq .Type "bind"}}{{.Destination}}{{end}}{{end}}',
        await containerOf(folder),
      ]);
      const state = {
        hostPath: (payload as {hostPath?: string}).hostPath,
        inside,
        mount: mounts.trim(),
        title: (await windowTitle(name)).startsWith(
          '[c54-h #x?% [Dev Container: Hash Name]]',
        ),
        dialog: await dialogOf(name),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        hostPath: folder,
        inside: '/workspaces/c54-h #x?%',
        mount: '/workspaces/c54-h #x?%',
        title: true,
        dialog: undefined,
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-1 (m4): the palette’s Rebuild items are the and-reopen pair in a local window and the in-container pair in a connected one, each without the other', async () => {
    const folder = devContainerFolder('c54-palette', {name: 'Palette'});
    try {
      const name = await openFolderWindow(folder);
      const local = await rebuildItems(name);
      await reopenInContainer(name);
      const inside = await rebuildItems(name);
      await closeWindow(name);
      deepStrictEqual(
        {local, inside},
        {
          local: [
            'Dev Containers: Rebuild and Reopen in Container',
            'Dev Containers: Rebuild Without Cache and Reopen in Container',
          ],
          inside: [
            'Dev Containers: Rebuild Container',
            'Dev Containers: Rebuild Container Without Cache',
          ],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
