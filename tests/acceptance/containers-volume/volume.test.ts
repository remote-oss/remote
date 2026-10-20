import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {volumeServerFolder} from 'lib-product';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  reopenStarted,
  variable,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The detail of F-0410's generic dialog (S034). */
const SETUP_FAILED = 'An error occurred setting up the container.';

/** The `product.json` of the editor under test. */
function productOf(): {
  applicationName: string;
  serverApplicationName: string;
  serverDataFolderName: string;
} {
  return JSON.parse(
    readFileSync(
      path.join(
        path.dirname(variable('HARNESS_VSCODIUM_EXECUTABLE')),
        'resources',
        'app',
        'product.json',
      ),
      'utf8',
    ),
  ) as ReturnType<typeof productOf>;
}

/** The product's server folder on the volume, from the application name of the editor under test and lib-product's rule. */
function serverFolderOf(): string {
  return `/vscode/${volumeServerFolder(productOf().applicationName)}`;
}

/** Runs `script` as root in a throwaway container of the run's image that mounts the `vscode` volume; its stdout. */
async function onVolume(script: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '--rm',
    '--user',
    'root',
    '--volume',
    'vscode:/vscode',
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sh',
    '-c',
    script,
  ]);
  return stdout;
}

/** The running containers of another run that mount the `vscode` volume, as `<id> <run>` lines. */
async function othersOnVolume(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'ps',
    '--filter',
    'volume=vscode',
    '--format',
    '{{.ID}} {{.Label "remote-oss.acceptance.run"}}',
  ]);
  return stdout
    .split('\n')
    .filter(line => line !== '')
    .filter(line => line.split(' ')[1] !== variable('HARNESS_RUN_ID'));
}

/** Empties the `vscode` volume, as a fresh one is: these rows need the volume alone, so another run's use fails them. */
async function clearVolume(): Promise<void> {
  const others = await othersOnVolume();
  if (others.length > 0) {
    throw new Error(
      `the vscode volume is in use by another run's containers: ${others.join(', ')}; this launch needs it alone`,
    );
  }
  await onVolume('rm -rf /vscode/* /vscode/.[!.]* 2>/dev/null; true');
}

/** The owner, mode and path of each server folder on the volume, to the commit folder's depth, in path order. */
async function serverFolders(): Promise<string[]> {
  const listing = await onVolume(
    "find /vscode -mindepth 1 -maxdepth 4 -path '/vscode/*-server*' -type d -exec stat -c '%U %a %n' {} \\;",
  );
  return listing
    .split('\n')
    .filter(line => line !== '')
    .sort(
      (left, right) =>
        left.split(' ')[2]?.localeCompare(right.split(' ')[2] ?? '') ?? 0,
    );
}

/** Runs `docker` with `parameters` and gives its stdout, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** Removes the `vscode` volume, and the containers of this run that hold it. */
async function removeVolume(): Promise<void> {
  const holders = await docker(
    'ps',
    '--all',
    '--quiet',
    '--filter',
    'volume=vscode',
    '--filter',
    `label=remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
  );
  if (holders !== '') {
    await docker('rm', '--force', ...holders.split('\n'));
  }
  await docker('volume', 'rm', '--force', 'vscode');
}

/** The ids among `containerIds` that are running. */
async function runningOf(containerIds: readonly string[]): Promise<string[]> {
  const running = [];
  for (const containerId of containerIds) {
    if (
      (await docker('inspect', '-f', '{{.State.Running}}', containerId)) ===
      'true'
    ) {
      running.push(containerId);
    }
  }
  return running;
}

/** Makes the `vscode` volume anew with `options` (`docker volume create` arguments), once no container holds it. */
async function recreateVolume(...options: string[]): Promise<void> {
  await removeVolume();
  await docker('volume', 'create', ...options, 'vscode');
}

/** The path, owner, mode and size of everything on the volume, in path order: what a listing of it shows. */
async function listing(): Promise<string[]> {
  return (
    await onVolume("find /vscode -mindepth 1 -printf '%p %U %m %s\\n' | sort")
  )
    .split('\n')
    .filter(line => line !== '');
}

/** The `<platform>/<commit>` folders under the server folder of the volume, in path order. */
async function installedOnVolume(): Promise<string[]> {
  return (
    await onVolume(
      `cd ${serverFolderOf()}/bin 2>/dev/null && find . -mindepth 2 -maxdepth 2 -type d | sed 's|^\\./||' | sort; true`,
    )
  )
    .split('\n')
    .filter(line => line !== '');
}

/** Opens `folder` in a window and starts the reopen that `connectedToContainer` or a dialog ends. */
async function windowOf(folder: string): Promise<string> {
  return openFolderWindow(folder);
}

describe("C10's root step for the vscode volume (card containers-25)", function () {
  this.timeout(600_000);
  after(async () => {
    // Later launches install afresh into a volume of their own making.
    await clearVolume();
  });

  it('F-0419 AC-37 (v1): a non-root remote user connects on a fresh volume (contracts §5.2); the shared folders are root 0777 and the commit folder is the user’s 0755', async () => {
    await clearVolume();
    const folder = devContainerFolder('volume-user', {
      name: 'Volume User',
      remoteUser: 'node',
    });
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    const state = await windowState(name);
    const folders = await serverFolders();
    console.log(
      `containers-25 V1: the server folders: ${JSON.stringify(folders)}`,
    );
    const serverFolder = serverFolderOf();
    deepStrictEqual(
      {
        remoteName: state.remoteName,
        containers: (await devContainersOf(folder)).length,
        shared: folders.slice(0, 3).map(line => line.split(' ').slice(0, 2)),
        names: folders.slice(0, 2).map(line => line.split(' ')[2]),
        depths: folders.map(line => line.split(' ')[2]?.split('/').length),
        commitOwner: folders[3]?.split(' ')[0],
        commitMode: folders[3]?.split(' ')[1],
      },
      {
        remoteName: 'dev-container',
        containers: 1,
        shared: [
          ['root', '777'],
          ['root', '777'],
          ['root', '777'],
        ],
        names: [serverFolder, `${serverFolder}/bin`],
        depths: [3, 4, 5, 6],
        commitOwner: 'node',
        commitMode: '755',
      },
    );
    await closeWindow(name);
  });

  it('F-0419 AC-24 (v2): a server folder that is root 0700 stays so, the install fails with the setup dialog, and the missing folders under it are made 0777', async () => {
    await clearVolume();
    const serverFolder = serverFolderOf();
    await onVolume(`mkdir -m 0700 ${serverFolder}`);
    const folder = devContainerFolder('volume-closed', {
      name: 'Volume Closed',
      remoteUser: 'node',
    });
    const name = await openFolderWindow(folder);
    void reopenInContainer(name).catch(() => undefined);
    const dialog = await waitForDialog(name, 300_000);
    const folders = await serverFolders();
    console.log(
      `containers-25 V2: the server folders: ${JSON.stringify(folders)}`,
    );
    deepStrictEqual(
      {
        detail: dialog.details,
        folders: folders.map(line => line.split(' ').slice(0, 2)),
        first: folders[0]?.split(' ')[2],
      },
      {
        detail: SETUP_FAILED,
        // The kept 0700 folder, then its bin and bin/<platform> made 0777, and no commit folder.
        folders: [
          ['root', '700'],
          ['root', '777'],
          ['root', '777'],
        ],
        first: serverFolder,
      },
    );
    await leaveFailed(name);
    await removeContainers(folder);
  });

  /** Leaves a window that shows the setup dialog: "Edit devcontainer.json Locally" gives a local window again, which closes. */
  async function leaveFailed(name: string): Promise<void> {
    await answerDialog(name, 'Edit devcontainer.json Locally');
    await windowState(name);
    await closeWindow(name);
  }

  /** Reopens `folder` expecting F-0410's setup dialog; gives the dialog, the window's remote name and indicator, and the folder's containers. */
  async function failedReopen(folder: string): Promise<{
    name: string;
    detail: string;
    indicator: string;
    containers: string[];
  }> {
    const name = await windowOf(folder);
    void reopenInContainer(name).catch(() => undefined);
    const dialog = await waitForDialog(name, 300_000);
    return {
      name,
      detail: dialog.details,
      indicator: await statusBarText(name, 'status.host'),
      containers: await devContainersOf(folder),
    };
  }

  it('F-0419 AC-16 (s16): a vscode volume that cannot be mounted shows the setup dialog with the window local and Opening Remote..., runs no container, and Retry shows it again', async () => {
    await clearVolume();
    await recreateVolume(
      '--driver',
      'local',
      '--opt',
      'type=none',
      '--opt',
      'o=bind',
      '--opt',
      'device=/c53v-no-such-folder',
    );
    const folder = devContainerFolder('volume-unmountable', {
      name: 'Volume Unmountable',
    });
    try {
      const first = await failedReopen(folder);
      const running = await runningOf(first.containers);
      await answerDialog(first.name, 'Retry');
      const again = await waitForDialog(first.name, 300_000);
      const afterRetry = await devContainersOf(folder);
      await leaveFailed(first.name);
      console.log(
        `c53v s16: ${JSON.stringify({first, running, again: again.details, afterRetry})}`,
      );
      deepStrictEqual(
        {
          first: {
            detail: first.detail,
            indicator: first.indicator,
            running,
          },
          again: again.details,
          atMostOne: afterRetry.length <= 1,
        },
        {
          first: {
            detail: SETUP_FAILED,
            indicator: 'Opening Remote...',
            running: [],
          },
          again: SETUP_FAILED,
          atMostOne: true,
        },
      );
    } finally {
      await removeContainers(folder);
      await recreateVolume();
    }
  });

  /** The `<platform>/<commit>` folder a first connect on a fresh volume made, after the connect's container and window are gone. */
  async function populate(folderName: string): Promise<string> {
    await clearVolume();
    const folder = devContainerFolder(folderName, {name: folderName});
    const name = await windowOf(folder);
    await reopenInContainer(name);
    await closeWindow(name);
    await removeContainers(folder);
    const [installed = ''] = await installedOnVolume();
    return installed;
  }

  it('F-0419 AC-25 (s25): a commit folder with only a stray file in it makes the setup dialog with Opening Remote..., a running container on the volume and an unchanged listing, for a second folder too', async () => {
    const installed = await populate('volume-seed');
    const commitFolder = `${serverFolderOf()}/bin/${installed}`;
    await onVolume(`rm -rf ${commitFolder}/* && touch ${commitFolder}/stray`);
    const before = await listing();
    const folders = ['volume-stray-a', 'volume-stray-b'].map(each =>
      devContainerFolder(each, {name: each}),
    );
    try {
      const outcomes = [];
      for (const folder of folders) {
        const failed = await failedReopen(folder);
        const [containerId = ''] = failed.containers;
        const running =
          containerId === ''
            ? 'none'
            : await docker('inspect', '-f', '{{.State.Running}}', containerId);
        const mounted =
          containerId === ''
            ? 'none'
            : await docker(
                'inspect',
                '-f',
                '{{range .Mounts}}{{if eq .Destination "/vscode"}}{{.Name}}{{end}}{{end}}',
                containerId,
              );
        await leaveFailed(failed.name);
        outcomes.push({
          detail: failed.detail,
          indicator: failed.indicator,
          running,
          mounted,
          unchanged: (await listing()).join('\n') === before.join('\n'),
        });
      }
      console.log(`c53v s25: ${JSON.stringify(outcomes)}`);
      const expected = {
        detail: SETUP_FAILED,
        indicator: 'Opening Remote...',
        running: 'true',
        mounted: 'vscode',
        unchanged: true,
      };
      deepStrictEqual(outcomes, [expected, expected]);
    } finally {
      for (const folder of folders) {
        await removeContainers(folder);
      }
    }
  });

  it('F-0419 AC-26 (s26): a vscode volume of 1 MiB makes the setup dialog with Opening Remote..., and the container runs with the volume at /vscode', async () => {
    await clearVolume();
    await recreateVolume(
      '--driver',
      'local',
      '--opt',
      'type=tmpfs',
      '--opt',
      'device=tmpfs',
      '--opt',
      'o=size=1m',
    );
    const folder = devContainerFolder('volume-small', {name: 'Volume Small'});
    try {
      const failed = await failedReopen(folder);
      const [containerId = ''] = failed.containers;
      const mounted =
        containerId === ''
          ? 'none'
          : await docker(
              'inspect',
              '-f',
              '{{range .Mounts}}{{if eq .Destination "/vscode"}}{{.Name}}{{end}}{{end}}',
              containerId,
            );
      await leaveFailed(failed.name);
      deepStrictEqual(
        {
          detail: failed.detail,
          indicator: failed.indicator,
          containers: failed.containers.length,
          mounted,
        },
        {
          detail: SETUP_FAILED,
          indicator: 'Opening Remote...',
          containers: 1,
          mounted: 'vscode',
        },
      );
    } finally {
      await removeContainers(folder);
      await recreateVolume();
    }
  });

  it('F-0419 AC-27 (s27): an older commit, another architecture and unrelated files on the volume stay, beside the new commit folder of a window that connects', async () => {
    await clearVolume();
    const server = serverFolderOf();
    await onVolume(
      [
        `mkdir -p -m 0777 ${server} ${server}/bin`,
        `mkdir -p ${server}/bin/alpine-x64/0000olderc0mmit ${server}/bin/alpine-arm64/0000otherarch`,
        `echo old > ${server}/bin/alpine-x64/0000olderc0mmit/old.txt`,
        `echo arm > ${server}/bin/alpine-arm64/0000otherarch/arm.txt`,
        `echo note > ${server}/bin/notes.txt`,
        'echo free > /vscode/unrelated.txt',
      ].join(' && '),
    );
    const before = await listing();
    const folder = devContainerFolder('volume-keeps', {name: 'Volume Keeps'});
    try {
      const name = await windowOf(folder);
      await reopenInContainer(name);
      const after = await listing();
      const installed = await installedOnVolume();
      await closeWindow(name);
      deepStrictEqual(
        {
          kept: before.filter(line => !after.includes(line)),
          installed: installed.map(line =>
            line.replace(/\/[0-9a-f]{40}$/, '/<commit>'),
          ),
        },
        {
          kept: [],
          installed: [
            'alpine-arm64/0000otherarch',
            'alpine-x64/0000olderc0mmit',
            'alpine-x64/<commit>',
          ],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0419 AC-36 (s36): two windows that start Reopen in Container together make one vscode volume, both connect with no dialog, and the platform has one commit folder', async () => {
    await clearVolume();
    await removeVolume();
    const folders = ['volume-race-a', 'volume-race-b'].map(each =>
      devContainerFolder(each, {name: each}),
    );
    try {
      const names = await Promise.all(folders.map(each => windowOf(each)));
      await Promise.all(names.map(each => reopenStarted(each)));
      await Promise.all(names.map(each => connectedToContainer(each, 400_000)));
      const volumes = (
        await docker('volume', 'ls', '--quiet', '--filter', 'name=^vscode$')
      )
        .split('\n')
        .filter(line => line !== '');
      const mounted = await Promise.all(
        folders.map(async each => {
          const [containerId = ''] = await devContainersOf(each);
          return docker(
            'inspect',
            '-f',
            '{{range .Mounts}}{{if eq .Destination "/vscode"}}{{.Name}}{{end}}{{end}}',
            containerId,
          );
        }),
      );
      const installed = await installedOnVolume();
      await Promise.all(names.map(each => closeWindow(each)));
      deepStrictEqual(
        {
          volumes,
          mounted,
          installed: installed.map(line =>
            line.replace(/\/[0-9a-f]{40}/, '/<commit>'),
          ),
        },
        {
          volumes: ['vscode'],
          mounted: ['vscode', 'vscode'],
          installed: ['alpine-x64/<commit>'],
        },
      );
    } finally {
      for (const folder of folders) {
        await removeContainers(folder);
      }
      await docker('volume', 'create', 'vscode');
    }
  });

  it('F-0419 AC-40 (s40): the remote user’s server link names the editor’s own folder and points into the volume’s folder of the editor’s own name, and no .vscode-server folder exists', async () => {
    await clearVolume();
    const folder = devContainerFolder('volume-names', {
      name: 'Volume Names',
      remoteUser: 'node',
    });
    try {
      const name = await windowOf(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const [installed = ''] = await installedOnVolume();
      const commit = installed.split('/')[1] ?? '';
      const product = productOf();
      const dataFolder = `/home/node/${product.serverDataFolderName}`;
      const link = await docker(
        'exec',
        containerId,
        'readlink',
        `${dataFolder}/bin/${commit}`,
      );
      const inFolder = await docker('exec', containerId, 'ls', `${link}/bin`);
      const homeFolders = await docker(
        'exec',
        containerId,
        'ls',
        '-A',
        '/home/node',
      );
      await closeWindow(name);
      console.log(
        `c53v s40: ${JSON.stringify({link, inFolder, homeFolders, dataFolder})}`,
      );
      deepStrictEqual(
        {
          link,
          holdsServer: inFolder
            .split('\n')
            .includes(product.serverApplicationName),
          noVscodeServer: !homeFolders.split('\n').includes('.vscode-server'),
        },
        {
          link: `${serverFolderOf()}/bin/${installed}`,
          holdsServer: true,
          noVscodeServer: true,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0419 AC-29 (s29): a build that fails on a host without a vscode volume ends in the setup dialog, with no container for the folder and no vscode volume made', async () => {
    await clearVolume();
    await removeVolume();
    const folder = devContainerFolder('volume-build-fails', {
      name: 'Volume Build Fails',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN exit 7\n`,
    );
    try {
      const failed = await failedReopen(folder);
      const holders = await docker(
        'ps',
        '--all',
        '--quiet',
        '--filter',
        'volume=vscode',
      );
      const volumes = (
        await docker('volume', 'ls', '--quiet', '--filter', 'name=^vscode$')
      )
        .split('\n')
        .filter(line => line !== '');
      await leaveFailed(failed.name);
      deepStrictEqual(
        {
          detail: failed.detail,
          containers: failed.containers,
          held: holders === '' ? [] : holders.split('\n'),
          volumes,
        },
        {detail: SETUP_FAILED, containers: [], held: [], volumes: []},
      );
    } finally {
      await removeContainers(folder);
      await recreateVolume();
    }
  });
});
