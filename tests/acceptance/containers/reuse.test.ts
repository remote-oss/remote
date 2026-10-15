import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {chmodSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reloadingCommand,
  reloadWindow,
  reopenInContainer,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  type ShownDialog,
  statusItem,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
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

/** F-0410's dialog details for a generic failure and for a missing docker, as `failure-strings.ts` has them. */
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

/** A dialog's buttons, sorted, without the Cancel core adds until C8 marks its close affordance (containers-35). */
function recoveryButtonsOf(dialog: ShownDialog): string[] {
  return dialog.buttons.filter(button => button !== 'Cancel').sort();
}

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

  it('F-0409 AC-2 (gate-row-4): a stopped container is started again with the same id, and no dialog shows', async () => {
    const folder = devContainerFolder('reuse-stopped');
    try {
      const stopped = await inspectOf(await containerLeftBy(folder));
      await execFileAsync('docker', ['stop', stopped.id]);
      const name = await reopened(folder);
      const dialog = await dialogOf(name);
      const containerIds = await devContainersOf(folder);
      const started = await inspectOf(containerIds[0] ?? '');
      await closeWindow(name);
      deepStrictEqual(
        {
          containers: containerIds.length,
          sameId: started.id === stopped.id,
          status: started.status,
          later: started.startedAt > stopped.startedAt,
          dialog,
        },
        {
          containers: 1,
          sameId: true,
          status: 'running',
          later: true,
          dialog: undefined,
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
          buttons: recoveryButtonsOf(dialog),
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
          buttons: recoveryButtonsOf(dialog),
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
          buttons: recoveryButtonsOf(dialog),
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
      const {stdout: docker} = await execFileAsync('sh', [
        '-c',
        'command -v docker',
      ]);
      const wrapper = path.join(
        variable('HARNESS_RUN_FOLDER'),
        'docker-no-daemon',
      );
      writeFileSync(
        wrapper,
        `#!/bin/sh\nDOCKER_HOST=unix:///tmp/remote-oss-no-daemon.sock exec ${docker.trim()} "$@"\n`,
      );
      chmodSync(wrapper, 0o755);
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
});
