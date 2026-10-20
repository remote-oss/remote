import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  dockerVolumes,
  inWindow,
  reopenInContainer,
  reopenStarted,
  windowNames,
  windowState,
  waitFor,
  variable,
} from '../windows/harness.ts';
import {
  answerDialog,
  type ShownDialog,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  activations,
  openFolderWindow,
  removeContainers,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** How long the connect to a container takes, up to the dialog that may replace it. */
const DIALOG_MILLISECONDS = 180_000;

/** The dialog core shows when the container's workspace does not exist (the card's core dialog). */
const CORE_DIALOG = {
  message: 'Workspace does not exist',
  details: 'Please select another workspace to open.',
  buttons: ['Cancel', 'Open Workspace...'],
};

/** The strings of the editor's table the failure dialogs show, as containers-11's rows have them. */
const S018 =
  'A mount config is invalid. Make sure it has the right format and a source folder that exists on the machine where the Docker daemon is running.';
const S034 = 'An error occurred setting up the container.';

/** One mount of a container, as `docker inspect -f '{{json .Mounts}}'` gives it. */
interface Mount {
  Type: string;
  Name?: string;
  Source: string;
  Destination: string;
}

/** The mounts of container `containerId`. */
async function mountsOf(containerId: string): Promise<Mount[]> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{json .Mounts}}',
    containerId,
  ]);
  return JSON.parse(stdout) as Mount[];
}

/** A label of container `containerId`, from `docker inspect -f '{{index .Config.Labels "<label>"}}'`, trimmed. */
async function labelOf(containerId: string, label: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    `{{index .Config.Labels "${label}"}}`,
    containerId,
  ]);
  return stdout.trim();
}

/** The names in `directory` inside container `containerId`, from `docker exec <id> ls -A <directory>`, sorted. */
async function namesIn(
  containerId: string,
  directory: string,
): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'ls',
    '-A',
    directory,
  ]);
  return stdout
    .split('\n')
    .filter(name => name !== '')
    .sort();
}

/** Makes `folder` a Git repository root: `git init -q <folder>`. */
async function gitRoot(folder: string): Promise<void> {
  await execFileAsync('git', ['init', '-q', folder]);
}

/** The path of window `name`'s folder, decoded from the URI it reports. */
async function folderPathOf(name: string): Promise<string> {
  const state = await windowState(name);
  return decodeURIComponent(new URL(state.folders[0] ?? '').pathname);
}

/** The one id `devContainersOf` gives for `folder`; it fails when the number is not one. */
async function containerOf(folder: string): Promise<string> {
  const containers = await devContainersOf(folder);
  const [containerId] = containers;
  if (containerId === undefined || containers.length !== 1) {
    throw new Error(
      `expected one container of ${folder}, found ${
        containers.length === 0 ? 'none' : containers.join(', ')
      }`,
    );
  }
  return containerId;
}

/** The mounts of container `containerId` whose destination is under /workspaces, as this file's Mount fields. */
async function workspaceMountsOf(containerId: string): Promise<Mount[]> {
  return (await mountsOf(containerId))
    .filter(mount => mount.Destination.startsWith('/workspaces'))
    .map(mount => {
      const mountOf: Mount = {
        Type: mount.Type,
        Source: mount.Source,
        Destination: mount.Destination,
      };
      if (mount.Name !== undefined) {
        mountOf.Name = mount.Name;
      }
      return mountOf;
    });
}

/** What a failure dialog says and answers with: its saying and its buttons, sorted. */
function sayingAndButtons(dialog: ShownDialog): {
  saying: {message: string; details: string};
  buttons: string[];
} {
  return {
    saying: {message: dialog.message, details: dialog.details},
    buttons: [...dialog.buttons].sort(),
  };
}

/** How many times each window of the run has activated its agent. */
function activationsOf(): Map<string, number> {
  const before = new Map<string, number>();
  for (const name of windowNames()) {
    before.set(name, activations(name));
  }
  return before;
}

/**
 * The name the row's window took after a Reopen in Container: the one window whose agent activated once more since
 * `before`. A Reopen reloads the window with the configured workspace folder, whose basename renames the window's
 * agent, so a row whose workspaceFolder names another folder follows its window to that name.
 */
async function renamedSince(
  before: ReadonlyMap<string, number>,
  milliseconds: number,
): Promise<string> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const moved = windowNames()
      .map(name => ({name, count: activations(name)}))
      .filter(each => (before.get(each.name) ?? 0) < each.count);
    if (moved.length === 1) {
      const [movedWindow] = moved;
      if (movedWindow !== undefined) {
        return movedWindow.name;
      }
    }
    if (moved.length > 1) {
      throw new Error(
        `the Reopen activated more windows: ${moved.map(each => each.name).join(', ')}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error('the Reopen activated no window');
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** Waits until window `name` reads its folder through the container, as the connect probe of the Reopen does. */
async function connectedToContainer(name: string): Promise<void> {
  await waitFor(
    `window ${name} to connect to its container`,
    async () => {
      try {
        await inWindow(name, 'acceptance.agent.statFolder');
        return (await windowState(name)).remoteName === 'dev-container';
      } catch {
        return false;
      }
    },
    DIALOG_MILLISECONDS,
  );
}

describe('F-0411 workspace mount and folder (card containers-26)', function () {
  this.timeout(900_000);

  it('F-0411 AC-1, AC-12 (w1): a repository root is mounted at /workspaces/<name> and the window opens there, with the folder labels', async () => {
    const folder = devContainerFolder('c26-root');
    let name: string | undefined;
    try {
      await gitRoot(folder);
      name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      deepStrictEqual(
        {
          mounts: await workspaceMountsOf(containerId),
          path: await folderPathOf(name),
          title: (await windowTitle(name)).startsWith(
            `[${path.basename(folder)} [`,
          ),
          labels: [
            await labelOf(containerId, 'devcontainer.local_folder'),
            await labelOf(containerId, 'devcontainer.config_file'),
          ],
        },
        {
          mounts: [
            {
              Type: 'bind',
              Source: folder,
              Destination: `/workspaces/${path.basename(folder)}`,
            },
          ],
          path: `/workspaces/${path.basename(folder)}`,
          title: true,
          labels: [
            folder,
            path.join(folder, '.devcontainer', 'devcontainer.json'),
          ],
        },
      );
    } finally {
      if (name) await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-2 (w2): a subfolder of a repository mounts the repository root and opens at the subfolder', async () => {
    const repository = path.join(variable('HARNESS_RUN_FOLDER'), 'c26-repo');
    const folder = devContainerFolder('c26-repo/sub/inner');
    let name: string | undefined;
    try {
      await gitRoot(repository);
      name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      deepStrictEqual(
        {
          mounts: await workspaceMountsOf(containerId),
          path: await folderPathOf(name),
          label: await labelOf(containerId, 'devcontainer.local_folder'),
        },
        {
          mounts: [
            {
              Type: 'bind',
              Source: repository,
              Destination: '/workspaces/c26-repo',
            },
          ],
          path: '/workspaces/c26-repo/sub/inner',
          label: folder,
        },
      );
    } finally {
      if (name) await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-3 (w3): a folder outside any repository is mounted itself', async () => {
    const folder = devContainerFolder('c26-plain');
    let name: string | undefined;
    try {
      name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      deepStrictEqual(await workspaceMountsOf(containerId), [
        {
          Type: 'bind',
          Source: folder,
          Destination: `/workspaces/${path.basename(folder)}`,
        },
      ]);
    } finally {
      if (name) await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-4 (w4): a workspaceMount of a sub-folder with a matching workspaceFolder mounts only that sub-folder', async () => {
    const folder = devContainerFolder('c26-sub', {
      workspaceMount:
        'source=${localWorkspaceFolder}/app,target=/workspaces/app,type=bind',
      workspaceFolder: '/workspaces/app',
    });
    mkdirSync(path.join(folder, 'app'), {recursive: true});
    writeFileSync(path.join(folder, 'app', 'inside.txt'), '');
    writeFileSync(path.join(folder, 'other.txt'), '');
    let name: string | undefined;
    let live: string | undefined;
    try {
      name = await openFolderWindow(folder);
      const before = activationsOf();
      await inWindow(name, 'remote-containers.reopenInContainer');
      live = await renamedSince(before, DIALOG_MILLISECONDS);
      await connectedToContainer(live);
      const containerId = await containerOf(folder);
      deepStrictEqual(
        {
          mounts: await workspaceMountsOf(containerId),
          appNames: await namesIn(containerId, '/workspaces/app'),
          workspaces: await namesIn(containerId, '/workspaces'),
          path: await folderPathOf(live),
          title: (await windowTitle(live)).startsWith('[app ['),
        },
        {
          mounts: [
            {
              Type: 'bind',
              Source: path.join(folder, 'app'),
              Destination: '/workspaces/app',
            },
          ],
          appNames: ['inside.txt'],
          workspaces: ['app'],
          path: '/workspaces/app',
          title: true,
        },
      );
    } finally {
      if (live) {
        await closeWindow(live);
      } else if (name) {
        await closeWindow(name);
      }
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-5 (w5): a workspaceMount of a new volume mounts a local volume of that name, empty, and no host folder', async () => {
    const volume = `c26-new-${variable('HARNESS_RUN_ID')}`.toLowerCase();
    const volumeBefore = (await dockerVolumes()).includes(volume);
    const folder = devContainerFolder('c26-volume', {
      workspaceMount: `source=${volume},target=/workspaces/vol,type=volume`,
      workspaceFolder: '/workspaces/vol',
    });
    let name: string | undefined;
    let live: string | undefined;
    try {
      name = await openFolderWindow(folder);
      const before = activationsOf();
      await inWindow(name, 'remote-containers.reopenInContainer');
      live = await renamedSince(before, DIALOG_MILLISECONDS);
      await connectedToContainer(live);
      const containerId = await containerOf(folder);
      const mounts = await mountsOf(containerId);
      deepStrictEqual(
        {
          volumeBefore,
          volume: (
            await execFileAsync('docker', [
              'volume',
              'inspect',
              '-f',
              '{{.Driver}}',
              volume,
            ])
          ).stdout.trim(),
          workspaces: mounts
            .filter(mount => mount.Destination.startsWith('/workspaces'))
            .map(mount => ({
              Type: mount.Type,
              Name: mount.Name,
              Destination: mount.Destination,
            })),
          bindOfFolder: mounts.some(
            mount => mount.Type === 'bind' && mount.Source === folder,
          ),
          files: await namesIn(containerId, '/workspaces/vol'),
        },
        {
          volumeBefore: false,
          volume: 'local',
          workspaces: [
            {Type: 'volume', Name: volume, Destination: '/workspaces/vol'},
          ],
          bindOfFolder: false,
          files: [],
        },
      );
    } finally {
      if (live) {
        await closeWindow(live);
      } else if (name) {
        await closeWindow(name);
      }
      await removeContainers(folder);
      if ((await dockerVolumes()).includes(volume)) {
        await execFileAsync('docker', ['volume', 'rm', '--force', volume]);
      }
    }
  });

  it('F-0411 AC-30 (w6): a workspaceMount of an existing volume shows its files and leaves the volume as it was', async () => {
    const volume = `c26-old-${variable('HARNESS_RUN_ID')}`.toLowerCase();
    await execFileAsync('docker', ['volume', 'create', volume]);
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    const folder = devContainerFolder('c26-volume-old', {
      workspaceMount: `source=${volume},target=/workspaces/vol,type=volume`,
      workspaceFolder: '/workspaces/vol',
    });
    let name: string | undefined;
    let live: string | undefined;
    try {
      await execFileAsync('docker', [
        'run',
        '--rm',
        `-v`,
        `${volume}:/data`,
        image,
        'sh',
        '-c',
        'echo kept > /data/kept.txt',
      ]);
      const {stdout: recorded} = await execFileAsync('docker', [
        'volume',
        'inspect',
        '-f',
        '{{.CreatedAt}}|{{json .Labels}}',
        volume,
      ]);
      const hostNames = readdirSync(folder).sort();
      name = await openFolderWindow(folder);
      const before = activationsOf();
      await inWindow(name, 'remote-containers.reopenInContainer');
      live = await renamedSince(before, DIALOG_MILLISECONDS);
      await connectedToContainer(live);
      const containerId = await containerOf(folder);
      const files = await namesIn(containerId, '/workspaces/vol');
      const volumeAfter = (
        await execFileAsync('docker', [
          'volume',
          'inspect',
          '-f',
          '{{.CreatedAt}}|{{json .Labels}}',
          volume,
        ])
      ).stdout;
      await closeWindow(live);
      live = undefined;
      name = undefined;
      await removeContainers(folder);
      const stillExists = (await dockerVolumes()).includes(volume);
      const {stdout: kept} = await execFileAsync('docker', [
        'run',
        '--rm',
        `-v`,
        `${volume}:/data`,
        image,
        'sh',
        '-c',
        'cat /data/kept.txt',
      ]);
      deepStrictEqual(
        {
          files,
          volumeAfter,
          hostNames: readdirSync(folder).sort(),
          stillExists,
          kept: kept.trim(),
        },
        {
          files: ['kept.txt'],
          volumeAfter: recorded,
          hostNames,
          stillExists: true,
          kept: 'kept',
        },
      );
    } finally {
      if (live) {
        await closeWindow(live);
      } else if (name) {
        await closeWindow(name);
      }
      await removeContainers(folder);
      await execFileAsync('docker', ['volume', 'rm', '--force', volume]);
    }
  });

  it('F-0411 AC-6 (w7): an empty workspaceMount gives no workspace mount, and core says the workspace does not exist', async () => {
    const folder = devContainerFolder('c26-nomount', {
      workspaceMount: '',
      workspaceFolder: '/workspaces/none',
    });
    let name: string | undefined;
    let live: string | undefined;
    try {
      name = await openFolderWindow(folder);
      const before = activationsOf();
      await inWindow(name, 'remote-containers.reopenInContainer');
      live = await renamedSince(before, DIALOG_MILLISECONDS);
      const dialog = await waitForDialog(live, DIALOG_MILLISECONDS);
      const containerId = await containerOf(folder);
      deepStrictEqual(
        {
          core: sayingAndButtons(dialog),
          workspaces: await workspaceMountsOf(containerId),
          remoteName: (await windowState(live)).remoteName,
        },
        {
          core: {
            saying: {
              message: CORE_DIALOG.message,
              details: CORE_DIALOG.details,
            },
            buttons: [...CORE_DIALOG.buttons].sort(),
          },
          workspaces: [],
          remoteName: 'dev-container',
        },
      );
      await answerDialog(live, 'Cancel');
    } finally {
      if (live) {
        await closeWindow(live);
      } else if (name) {
        await closeWindow(name);
      }
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-7, F-0301 AC-14 (w8): a workspaceFolder alone keeps the default mount, and core says the workspace does not exist', async () => {
    const folder = devContainerFolder('c26-folder-only', {
      workspaceFolder: '/workspaces/custom',
    });
    let name: string | undefined;
    let live: string | undefined;
    try {
      name = await openFolderWindow(folder);
      const before = activationsOf();
      await inWindow(name, 'remote-containers.reopenInContainer');
      live = await renamedSince(before, DIALOG_MILLISECONDS);
      const dialog = await waitForDialog(live, DIALOG_MILLISECONDS);
      const containerId = await containerOf(folder);
      deepStrictEqual(
        {
          core: sayingAndButtons(dialog),
          workspaces: await workspaceMountsOf(containerId),
        },
        {
          core: {
            saying: {
              message: CORE_DIALOG.message,
              details: CORE_DIALOG.details,
            },
            buttons: [...CORE_DIALOG.buttons].sort(),
          },
          workspaces: [
            {
              Type: 'bind',
              Source: folder,
              Destination: `/workspaces/${path.basename(folder)}`,
            },
          ],
        },
      );
      await answerDialog(live, 'Cancel');
    } finally {
      if (live) {
        await closeWindow(live);
      } else if (name) {
        await closeWindow(name);
      }
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-16 (w9): a workspaceMount alone keeps it, and the window tries the default path', async () => {
    const folder = devContainerFolder('c26-mount-only', {
      workspaceMount:
        'source=${localWorkspaceFolder}/app,target=/workspaces/app,type=bind',
    });
    mkdirSync(path.join(folder, 'app'), {recursive: true});
    writeFileSync(path.join(folder, 'app', 'inside.txt'), '');
    let name: string | undefined;
    try {
      name = await openFolderWindow(folder);
      await reopenStarted(name);
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const containerId = await containerOf(folder);
      deepStrictEqual(
        {
          core: sayingAndButtons(dialog),
          workspaces: await workspaceMountsOf(containerId),
          path: await folderPathOf(name),
          title: (await windowTitle(name)).startsWith(
            `[${path.basename(folder)} [`,
          ),
        },
        {
          core: {
            saying: {
              message: CORE_DIALOG.message,
              details: CORE_DIALOG.details,
            },
            buttons: [...CORE_DIALOG.buttons].sort(),
          },
          workspaces: [
            {
              Type: 'bind',
              Source: path.join(folder, 'app'),
              Destination: '/workspaces/app',
            },
          ],
          path: `/workspaces/${path.basename(folder)}`,
          title: true,
        },
      );
      await answerDialog(name, 'Cancel');
    } finally {
      if (name) await closeWindow(name);
      await removeContainers(folder);
    }
  });

  // The ruling on #954: the absolute-path saying is the dialog's detail with an empty message, the family's modal
  // error shape; the row answers the dialog's Cancel and checks that no container was made.
  it('F-0411 AC-41 (w10): an empty workspaceFolder makes no container and leaves the folder to reopen locally', async () => {
    const folder = devContainerFolder('c26-empty-folder', {
      workspaceFolder: '',
    });
    let name: string | undefined;
    try {
      name = await openFolderWindow(folder);
      const before = activations(name);
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      const saying = sayingAndButtons(await waitForDialog(name, 60_000));
      await answerDialog(name, 'Cancel');
      await running;
      deepStrictEqual(
        {
          saying,
          activations: activations(name),
          remoteName: (await windowState(name)).remoteName,
          containers: await devContainersOf(folder),
        },
        {
          saying: {
            saying: {
              message: '',
              details:
                'Workspace folder in devcontainer.json must be an absolute path.',
            },
            buttons: ['Cancel', 'Show Log'],
          },
          activations: before,
          remoteName: null,
          containers: [],
        },
      );
    } finally {
      if (name) await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-42 (w11): a folder named a,b=c is mounted with that name', async () => {
    const folder = devContainerFolder('a,b=c');
    let name: string | undefined;
    try {
      await gitRoot(folder);
      name = await openFolderWindow(folder);
      await reopenStarted(name);
      await waitFor(
        `one container of ${folder}`,
        async () => (await devContainersOf(folder)).length === 1,
        180_000,
      );
      const containerId = await containerOf(folder);
      deepStrictEqual(
        {
          workspaces: await workspaceMountsOf(containerId),
          label: await labelOf(containerId, 'devcontainer.local_folder'),
        },
        {
          workspaces: [
            {Type: 'bind', Source: folder, Destination: '/workspaces/a,b=c'},
          ],
          label: folder,
        },
      );
    } finally {
      if (name) await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it("F-0411 AC-18 (w12): a bind workspaceMount whose source does not exist makes no container and shows F-0410's dialog", async () => {
    const folder = devContainerFolder('c26-missing-source', {
      workspaceMount:
        'source=${localWorkspaceFolder}/nowhere,target=/workspaces/x,type=bind',
      workspaceFolder: '/workspaces/x',
    });
    let name: string | undefined;
    let live: string | undefined;
    try {
      name = await openFolderWindow(folder);
      const before = activationsOf();
      await inWindow(name, 'remote-containers.reopenInContainer');
      live = await renamedSince(before, DIALOG_MILLISECONDS);
      const dialog = await waitForDialog(live, DIALOG_MILLISECONDS);
      deepStrictEqual(
        {
          failure: sayingAndButtons(dialog),
          containers: await devContainersOf(folder),
        },
        {
          failure: {
            saying: {message: '', details: S018},
            buttons: [
              'Edit devcontainer.json Locally',
              'More Actions...',
              'Retry',
            ],
          },
          containers: [],
        },
      );
    } finally {
      if (live) {
        await closeWindow(live);
      } else if (name) {
        await closeWindow(name);
      }
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-40 (w13): a bind without source and a volume name Docker refuses make no container and no volume', async () => {
    const noSource = devContainerFolder('c26-no-source', {
      workspaceMount: 'target=/workspaces/x,type=bind',
      workspaceFolder: '/workspaces/x',
    });
    const badVolume = devContainerFolder('c26-bad-volume', {
      workspaceMount: 'source=bad/name,target=/workspaces/x,type=volume',
      workspaceFolder: '/workspaces/x',
    });
    const volumesBefore = await dockerVolumes();
    // The row's windows, each by the name it opened under and the one its Reopen takes.
    const windows: Array<{orig: string; live: string | undefined}> = [];
    try {
      const firstWindow = {
        orig: await openFolderWindow(noSource),
        live: undefined as string | undefined,
      };
      windows.push(firstWindow);
      const beforeFirst = activationsOf();
      await inWindow(firstWindow.orig, 'remote-containers.reopenInContainer');
      const firstLive = await renamedSince(beforeFirst, DIALOG_MILLISECONDS);
      firstWindow.live = firstLive;
      const firstDialog = await waitForDialog(firstLive, DIALOG_MILLISECONDS);
      // The first window reclaims the name the second will take, so it goes before the next opens.
      await closeWindow(firstLive);
      windows.splice(0, 1);
      const secondWindow = {
        orig: await openFolderWindow(badVolume),
        live: undefined as string | undefined,
      };
      windows.push(secondWindow);
      const beforeSecond = activationsOf();
      await inWindow(secondWindow.orig, 'remote-containers.reopenInContainer');
      const secondLive = await renamedSince(beforeSecond, DIALOG_MILLISECONDS);
      secondWindow.live = secondLive;
      const secondDialog = await waitForDialog(secondLive, DIALOG_MILLISECONDS);
      deepStrictEqual(
        {
          noSource: sayingAndButtons(firstDialog),
          badVolume: sayingAndButtons(secondDialog),
          containers: [
            await devContainersOf(noSource),
            await devContainersOf(badVolume),
          ],
          volumes: await dockerVolumes(),
        },
        {
          noSource: {
            saying: {message: '', details: S018},
            buttons: [
              'Edit devcontainer.json Locally',
              'More Actions...',
              'Retry',
            ],
          },
          badVolume: {
            saying: {message: '', details: S034},
            buttons: [
              'Edit devcontainer.json Locally',
              'More Actions...',
              'Retry',
            ],
          },
          containers: [[], []],
          volumes: volumesBefore,
        },
      );
    } finally {
      for (const entry of windows.reverse()) {
        await closeWindow(entry.live ?? entry.orig);
      }
      await removeContainers(noSource);
      await removeContainers(badVolume);
    }
  });
});
