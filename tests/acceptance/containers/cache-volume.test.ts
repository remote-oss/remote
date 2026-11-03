import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  activeEditorOf,
  closeWindow,
  connectedToContainer,
  containersLog,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  GLIBC_IMAGE,
  reloadingCommand,
  reopenInContainer,
  reopenStarted,
  runLabelArguments,
  startInWindow,
  userScopeHolds,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {settingsText} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  problemsOf,
  statusBarText,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The error dialog's text of F-0410 (STR:S034). */
const S034 = 'An error occurred setting up the container.';

/** How long a rebuild may take to make its new container. */
const REBUILD_MILLISECONDS = 240_000;

/** The output of `docker` run with `parameters`, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** A mount of a container, as `docker inspect` says it. */
interface Mount {
  Type: string;
  Name?: string;
  Destination: string;
  RW: boolean;
}

/** The mounts of container `containerId`. */
async function mountsOf(containerId: string): Promise<Mount[]> {
  return JSON.parse(
    await docker('inspect', '-f', '{{json .Mounts}}', containerId),
  ) as Mount[];
}

/** The mount at `/vscode` of container `containerId`, as its type, volume name and mode, or nothing. */
async function vscodeMountOf(
  containerId: string,
): Promise<[string, string | undefined, boolean] | undefined> {
  const mount = (await mountsOf(containerId)).find(
    each => each.Destination === '/vscode',
  );
  return mount === undefined ? undefined : [mount.Type, mount.Name, mount.RW];
}

/** The creation time of volume `volume`, or nothing when it does not exist. */
async function createdAtOf(volume: string): Promise<string | undefined> {
  try {
    return (
      await docker('volume', 'inspect', '-f', '{{.CreatedAt}}', volume)
    ).trim();
  } catch {
    return undefined;
  }
}

/** What the server link of the remote user points at in container `containerId`: `/vscode/<server>/bin/<platform>/<commit>`. */
async function serverLinkOf(containerId: string): Promise<string> {
  return docker(
    'exec',
    containerId,
    'sh',
    '-c',
    'for link in "$HOME"/.*-server*/bin/*; do [ -L "$link" ] && readlink "$link"; done',
  );
}

/**
 * Where the extension keeps the archive of the server for `platform` in the client's cache (`<tmpdir>/
 * vscode-remote-containers/<application>/<quality>/<commit>/<server>-<platform>-<quality>.tar.gz`, F-0503 5.0 step 5).
 */
function cachedArchiveOf(platform: string): string {
  const product = editorProduct();
  return path.join(
    tmpdir(),
    'vscode-remote-containers',
    product.applicationName,
    product.quality,
    product.commit,
    `${product.serverApplicationName}-${platform}-${product.quality}.tar.gz`,
  );
}

/** The run's pinned Alpine server archive, which the harness keeps beside its other downloads. */
function pinnedAlpineArchive(): string {
  const downloads = path.join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '.vscode-test',
    'downloads',
  );
  return path.join(
    downloads,
    readdirSync(downloads).find(file => file.includes('reh-alpine-x64')) ??
      'missing',
  );
}

/** How many lines the download host's request log has. */
function downloadRequests(): string[] {
  return readFileSync(variable('HARNESS_DOWNLOADS_LOG'), 'utf8')
    .split('\n')
    .filter(line => line !== '');
}

/** The commit folders in the platform folder that `link` (a server link's target) is in, as seen from container `containerId`. */
async function commitsBesideOf(
  containerId: string,
  link: string,
): Promise<string[]> {
  return (await docker('exec', containerId, 'ls', link.replace(/\/[^/]*$/, '')))
    .split('\n')
    .filter(line => line !== '');
}

/** How many extension folders the remote user of container `containerId` has installed. */
async function installedCountOf(containerId: string): Promise<number> {
  return Number(
    await docker(
      'exec',
      containerId,
      'sh',
      '-c',
      `ls "$(cd; pwd)/${editorProduct().serverDataFolderName}/extensions" 2>/dev/null | grep -c . ; true`,
    ),
  );
}

/** A small extension with a package and a published checksum on Open VSX, and the folder name part its version gives. */
const CACHED_EXTENSION = 'mechatroner.rainbow-csv';

/** A second small extension, which no other row caches. */
const OFFLINE_EXTENSION = 'oderwat.indent-rainbow';

/** The shared cache's folder on the volume, named for the editor's application (containers contracts §5.2). */
function sharedCacheFolder(): string {
  return `/vscode/extensionsCache-${editorProduct().applicationName}`;
}

/** The folder of the container's own extension cache, for its remote user. */
const OWN_CACHE_SHELL = '"$HOME/$SERVER_DATA/extensionsCache"';

/** The files in the container's own extension cache, as `name -> link target or empty`. */
async function ownEntriesOf(
  containerId: string,
): Promise<Record<string, string>> {
  const listed = await docker(
    'exec',
    containerId,
    'sh',
    '-c',
    `SERVER_DATA=${editorProduct().serverDataFolderName}; for file in ${OWN_CACHE_SHELL}/*; do [ -e "$file" ] || [ -L "$file" ] || continue; echo "$(basename "$file")|$(readlink "$file")"; done`,
  );
  return Object.fromEntries(
    listed
      .split('\n')
      .filter(line => line !== '')
      .map(line => line.split('|') as [string, string]),
  );
}

/** The package files in the shared cache folder of the volume, as seen from container `containerId`. */
async function sharedFilesOf(containerId: string): Promise<string[]> {
  return (
    await docker(
      'exec',
      containerId,
      'sh',
      '-c',
      `ls ${sharedCacheFolder()} 2>/dev/null || true`,
    )
  )
    .split('\n')
    .filter(line => line !== '');
}

/** How long the shared cache has to get a package after the connect: the client fills it in the background. */
const CACHE_FILL_MILLISECONDS = 90_000;

/** The package file in the shared cache folder, once the client has put it there, as seen from container `containerId`. */
async function sharedPackageOf(containerId: string): Promise<string> {
  let file = '';
  await waitFor(
    'the package in the shared cache',
    async () => {
      file =
        (await sharedFilesOf(containerId)).find(each =>
          each.endsWith('.vsix'),
        ) ?? '';
      return file !== '';
    },
    CACHE_FILL_MILLISECONDS,
  );
  return file;
}

/** Whether `file` in the container is a regular file (not a link), and its size. */
async function realFileSizeOf(
  containerId: string,
  file: string,
): Promise<number | undefined> {
  const printed = await docker(
    'exec',
    containerId,
    'sh',
    '-c',
    `[ -f '${file}' ] && [ ! -L '${file}' ] && stat -c %s '${file}' || true`,
  );
  return printed === '' ? undefined : Number(printed);
}

/** The size the container's entry `file` resolves to, or nothing when the entry is not there. */
async function resolvedSizeOfSafe(
  containerId: string,
  own: Record<string, string>,
  file: string,
): Promise<number | undefined> {
  return file in own
    ? resolvedSizeOf(
        containerId,
        `$HOME/${editorProduct().serverDataFolderName}/extensionsCache/${file}`,
      )
    : undefined;
}

/** The size the container's entry resolves to, following the link. */
async function resolvedSizeOf(
  containerId: string,
  file: string,
): Promise<number> {
  return Number(
    await docker('exec', containerId, 'sh', '-c', `stat -L -c %s "${file}"`),
  );
}

/** Whether the extension `extensionId` is installed for the remote user of container `containerId`. */
async function installedExtension(
  containerId: string,
  extensionId: string,
): Promise<boolean> {
  return (
    (await docker(
      'exec',
      containerId,
      'sh',
      '-c',
      `ls "$HOME/${editorProduct().serverDataFolderName}/extensions" 2>/dev/null | grep -ci '^${extensionId}-' || true`,
    )) !== '0'
  );
}

/** The containers that mount the vscode volume, each as its id, run label and the local folder of its configuration. */
async function vscodeHolders(): Promise<
  Array<{containerId: string; runLabel: string; localFolder: string}>
> {
  const listed = await docker(
    'ps',
    '--all',
    '--filter',
    'volume=vscode',
    '--format',
    '{{.ID}}|{{.Label "remote-oss.acceptance.run"}}|{{.Label "devcontainer.local_folder"}}',
  );
  return listed
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const [containerId = '', runLabel = '', localFolder = ''] =
        line.split('|');
      return {containerId, runLabel, localFolder};
    });
}

/** Whether the holder was made by this run: it has the run's label, or was made for a folder of the run folder. */
function ownedByRun(holder: {runLabel: string; localFolder: string}): boolean {
  return (
    holder.runLabel === variable('HARNESS_RUN_ID') ||
    holder.localFolder.startsWith(variable('HARNESS_RUN_FOLDER'))
  );
}

/**
 * Removes the run's containers that mount the vscode volume, those with its run label and the unlabelled ones made for
 * a folder of its run folder, and the volume, so that the next container finds none; it fails naming any other holder.
 */
async function noVscodeVolume(): Promise<void> {
  const holders = await vscodeHolders();
  const foreign = holders.filter(holder => !ownedByRun(holder));
  if (foreign.length > 0) {
    throw new Error(
      `containers of another run hold the vscode volume: ${foreign.map(holder => holder.containerId).join(', ')}`,
    );
  }
  if (holders.length > 0) {
    await docker('rm', '--force', ...holders.map(holder => holder.containerId));
  }
  await docker('volume', 'rm', '--force', 'vscode');
}

/** A folder whose configuration installs the extension `extensionId`. */
function extensionFolder(name: string, extensionId: string): string {
  return devContainerFolder(name, {
    name,
    customizations: {vscode: {extensions: [extensionId]}},
  });
}

/** Opens a window on `folder` and reopens it in its container; gives the window and the container's id. */
async function opened(
  folder: string,
): Promise<{name: string; containerId: string}> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  const [containerId = ''] = await devContainersOf(folder);
  return {name, containerId};
}

/** Runs the rebuild `command` in window `name`, and gives the container the folder has once the old one is replaced. */
async function rebuiltBy(
  name: string,
  folder: string,
  before: string,
  command: string,
): Promise<string> {
  await reloadingCommand(name, command);
  let made = '';
  await waitFor(
    'the rebuild to make a new container',
    async () => {
      const containerIds = await devContainersOf(folder);
      made = containerIds.find(each => each !== before) ?? '';
      return made !== '' && containerIds.length === 1;
    },
    REBUILD_MILLISECONDS,
  );
  await connectedToContainer(name, REBUILD_MILLISECONDS);
  return made;
}

/** How a connect looks in the window: the connecting toasts it showed, the remote indicator and the title at its end. */
interface Look {
  toasts: string[];
  indicator: string;
  title: string;
}

/** What of a connect's look does not depend on whether the server had to be installed: the toasts without their stage, the stages being only the server's, the indicator and the title. */
function baseOf(look: Look | undefined): {
  toasts: string[];
  stages: boolean;
  indicator: string | undefined;
  title: string | undefined;
} {
  const texts = look?.toasts ?? [];
  return {
    toasts: [...new Set(texts.map(text => text.replace(/: .*$/, '')))],
    stages: texts
      .filter(text => text.includes(': '))
      .every(text =>
        ['Installing server', 'Starting server'].includes(
          text.split(': ')[1] ?? '',
        ),
      ),
    indicator: look?.indicator,
    title: look?.title,
  };
}

describe('F-0419 the vscode cache volume (card containers-53)', function () {
  this.timeout(900_000);

  it('F-0419 AC-1, AC-2, AC-6, AC-7 (c1): a container mounts the vscode volume read-write at /vscode, an unrelated one mounts the same volume with its one commit folder, and neither rebuild changes the volume', async () => {
    const first = devContainerFolder('c53v-one', {name: 'Volume One'});
    const second = devContainerFolder('c53v-two', {
      name: 'Volume Two',
      containerEnv: {ROW_NAME: 'two'},
    });
    try {
      const firstOpen = await opened(first);
      const mountOne = await vscodeMountOf(firstOpen.containerId);
      const createdAt = await createdAtOf('vscode');
      const linkOne = await serverLinkOf(firstOpen.containerId);
      const commitsOne = await commitsBesideOf(firstOpen.containerId, linkOne);
      await closeWindow(firstOpen.name);
      const secondOpen = await opened(second);
      const mountTwo = await vscodeMountOf(secondOpen.containerId);
      const createdAtAfterTwo = await createdAtOf('vscode');
      const linkTwo = await serverLinkOf(secondOpen.containerId);
      const commitsTwo = await commitsBesideOf(secondOpen.containerId, linkTwo);
      const rebuilt = await rebuiltBy(
        secondOpen.name,
        second,
        secondOpen.containerId,
        'remote-containers.rebuildContainer',
      );
      const mountRebuilt = await vscodeMountOf(rebuilt);
      const createdAtAfterRebuild = await createdAtOf('vscode');
      const rebuiltClean = await rebuiltBy(
        secondOpen.name,
        second,
        rebuilt,
        'remote-containers.rebuildContainerNoCache',
      );
      const mountClean = await vscodeMountOf(rebuiltClean);
      const createdAtAfterClean = await createdAtOf('vscode');
      await closeWindow(secondOpen.name);
      console.log(
        `c53v c1: ${JSON.stringify({linkOne, commitsOne, linkTwo, commitsTwo})}`,
      );
      deepStrictEqual(
        {
          mountOne,
          mountTwo,
          mountRebuilt,
          mountClean,
          sameVolume: [
            createdAtAfterTwo,
            createdAtAfterRebuild,
            createdAtAfterClean,
          ].every(each => each === createdAt),
          oneCommit: commitsOne.length === 1 && commitsTwo.length === 1,
          sameCommit: linkOne === linkTwo,
        },
        {
          mountOne: ['volume', 'vscode', true],
          mountTwo: ['volume', 'vscode', true],
          mountRebuilt: ['volume', 'vscode', true],
          mountClean: ['volume', 'vscode', true],
          sameVolume: true,
          oneCommit: true,
          sameCommit: true,
        },
      );
    } finally {
      await removeContainers(first);
      await removeContainers(second);
    }
  });

  /** The names of the volumes of the daemon. */
  async function volumeNames(): Promise<string[]> {
    return (await docker('volume', 'ls', '-q'))
      .split('\n')
      .filter(line => line !== '');
  }

  /** The text the collision dialog gives for `property` mounting `target`. */
  function reserved(property: string, target: string): string {
    return `'${property}' mounts '${target}': '/vscode' and the paths below it are reserved for the cache volume while dev.containers.cacheVolume is true.`;
  }

  /** What a failed collision attempt shows and leaves: the dialog, its buttons, and what exists on the daemon. */
  interface Collision {
    details: string;
    buttons: string[];
    containers: string[];
    volumes: string[];
  }

  /** Reads the dialog of window `name`, with the folder's containers and the daemon's volumes at that moment. */
  async function collisionOf(name: string, folder: string): Promise<Collision> {
    const dialog = await waitForDialog(name, 300_000);
    return {
      details: dialog.details,
      buttons: dialog.buttons,
      containers: await devContainersOf(folder),
      volumes: await volumeNames(),
    };
  }

  /** Removes the volumes the rows of the collision create, and the `vscode` volume. */
  async function noCollisionVolumes(...own: string[]): Promise<void> {
    await noVscodeVolume();
    for (const volume of own) {
      await docker('volume', 'rm', '--force', volume).catch(() => undefined);
    }
  }

  it('F-0419 AC-14, AC-33 (c14): a mounts entry at /vscode fails before anything is created with a dialog naming /vscode and mounts, Retry gives it again, and a mount of the vscode volume at /cache connects with it at both targets', async () => {
    await noCollisionVolumes('c53v-own');
    const folder = devContainerFolder('c53v-mounts', {
      name: 'Volume Mounts',
      mounts: ['source=c53v-own,target=/vscode/data,type=volume'],
    });
    const name = await openFolderWindow(folder);
    try {
      await startInWindow(name, 'remote-containers.reopenInContainer');
      const first = await collisionOf(name, folder);
      await answerDialog(name, 'Retry');
      const again = await collisionOf(name, folder);
      await answerDialog(name, 'Edit devcontainer.json Locally');
      await waitFor(
        'the configuration file to be open in a local window',
        async () =>
          (await activeEditorOf(name).catch(() => null)) ===
          path.join(folder, '.devcontainer', 'devcontainer.json'),
        60_000,
      );
      const local = await windowState(name);
      deepStrictEqual(
        {
          dialogs: [first.details, again.details],
          offered: [first.buttons, again.buttons],
          containers: [first.containers, again.containers],
          volumes: [first.volumes, again.volumes].map(
            names => names.includes('vscode') || names.includes('c53v-own'),
          ),
          remote: local.remoteName,
        },
        {
          dialogs: [
            reserved('mounts', '/vscode/data'),
            reserved('mounts', '/vscode/data'),
          ],
          offered: [
            ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
            ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
          ],
          containers: [[], []],
          volumes: [false, false],
          remote: null,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
      await docker('volume', 'rm', '--force', 'c53v-own').catch(
        () => undefined,
      );
    }
  });

  it('F-0419 AC-14 (c14-cache): a mounts entry that names the vscode volume at /cache is no collision: the container connects with the volume at /vscode and at /cache', async () => {
    await noVscodeVolume();
    const folder = devContainerFolder('c53v-cache', {
      name: 'Volume Cache',
      mounts: ['source=vscode,target=/cache,type=volume'],
    });
    try {
      const {name, containerId} = await opened(folder);
      const mounts = (await mountsOf(containerId))
        .filter(each => each.Name === 'vscode')
        .map(each => each.Destination)
        .sort();
      await closeWindow(name);
      deepStrictEqual(mounts, ['/cache', '/vscode']);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0419 AC-23 (c23): runArgs with -v (also attached), --volume= and --mount at /vscode, and a workspaceMount at /vscode, each fail before anything is created with a dialog naming the property', async () => {
    await noCollisionVolumes('c53v-run');
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ['runArgs', '/vscode', {runArgs: ['-v', 'c53v-run:/vscode']}],
      ['runArgs', '/vscode/x', {runArgs: ['--volume=c53v-run:/vscode/x']}],
      ['runArgs', '/vscode', {runArgs: ['-vc53v-run:/vscode']}],
      [
        'runArgs',
        '/vscode',
        {runArgs: ['--mount', 'type=volume,source=c53v-run,target=/vscode']},
      ],
      [
        'workspaceMount',
        '/vscode',
        {workspaceMount: 'source=c53v-run,target=/vscode,type=volume'},
      ],
    ];
    const seen: Array<[string, string[], boolean]> = [];
    const folders: string[] = [];
    try {
      for (const [index, [, , configuration]] of cases.entries()) {
        const folder = devContainerFolder(`c53v-run-${String(index)}`, {
          name: 'Volume Run',
          ...configuration,
        });
        folders.push(folder);
        const name = await openFolderWindow(folder);
        try {
          await startInWindow(name, 'remote-containers.reopenInContainer');
          const outcome = await collisionOf(name, folder);
          seen.push([
            outcome.details,
            outcome.containers,
            outcome.volumes.includes('vscode') ||
              outcome.volumes.includes('c53v-run'),
          ]);
        } finally {
          await answerDialog(name, 'Cancel').catch(() => undefined);
          await closeWindow(name).catch(() => undefined);
        }
      }
      deepStrictEqual(
        seen,
        cases.map(([property, target]) => [
          reserved(property, target),
          [],
          false,
        ]),
      );
    } finally {
      for (const folder of folders) {
        await removeContainers(folder);
      }
    }
  });

  it('F-0419 AC-22 (c22): a mounts entry at /vscode added to an existing container’s configuration fails the Rebuild with the dialog before the old container is removed, and nothing new is created', async () => {
    await noCollisionVolumes('c53v-added');
    const folder = devContainerFolder('c53v-added', {name: 'Volume Added'});
    try {
      const {name, containerId} = await opened(folder);
      const volumesBefore = await volumeNames();
      const file = path.join(folder, '.devcontainer', 'devcontainer.json');
      const configuration = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        unknown
      >;
      writeFileSync(
        file,
        JSON.stringify({
          ...configuration,
          mounts: ['source=c53v-added,target=/vscode,type=volume'],
        }),
      );
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      const outcome = await collisionOf(name, folder);
      await answerDialog(name, 'Edit devcontainer.json Locally');
      await closeWindow(name);
      deepStrictEqual(
        {
          details: outcome.details,
          containers: outcome.containers,
          sameContainer: containerId !== '',
          newVolumes: outcome.volumes.filter(
            volume => !volumesBefore.includes(volume),
          ),
        },
        {
          details: reserved('mounts', '/vscode'),
          containers: [containerId],
          sameContainer: true,
          newVolumes: [],
        },
      );
    } finally {
      await removeContainers(folder);
      await docker('volume', 'rm', '--force', 'c53v-added').catch(
        () => undefined,
      );
    }
  });

  it('containers-148 (c43): F-0419 7.E2, after the collision dialog, a mounts entry retargeted to /data connects with the vscode volume at /vscode', async () => {
    await noCollisionVolumes('c53v-retarget');
    const folder = devContainerFolder('c53v-retarget', {
      name: 'Volume Retarget',
      mounts: ['source=c53v-retarget,target=/vscode,type=volume'],
    });
    const file = path.join(folder, '.devcontainer', 'devcontainer.json');
    const first = await openFolderWindow(folder);
    try {
      await startInWindow(first, 'remote-containers.reopenInContainer');
      const shown = await collisionOf(first, folder);
      await answerDialog(first, 'Edit devcontainer.json Locally');
      await waitFor(
        'the configuration file to be open in a local window',
        async () => (await activeEditorOf(first).catch(() => null)) === file,
        60_000,
      );
      const configuration = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        unknown
      >;
      writeFileSync(
        file,
        JSON.stringify({
          ...configuration,
          mounts: ['source=c53v-retarget,target=/data,type=volume'],
        }),
      );
      await reopenInContainer(first);
      const [containerId = ''] = await devContainersOf(folder);
      deepStrictEqual(
        [shown.details, await vscodeMountOf(containerId)],
        [reserved('mounts', '/vscode'), ['volume', 'vscode', true]],
      );
    } finally {
      await closeWindow(first).catch(() => undefined);
      await removeContainers(folder);
      await docker('volume', 'rm', '--force', 'c53v-retarget').catch(
        () => undefined,
      );
    }
  });

  it('containers-148 (c44): F-0419 7.E2, with cacheVolume false a mounts entry at /vscode is no collision: the window connects with the mount as written and no vscode volume exists', async () => {
    await noCollisionVolumes('c53v-off');
    await setUserSetting('dev.containers.cacheVolume', false);
    const folder = devContainerFolder('c53v-off', {
      name: 'Volume Off',
      mounts: ['source=c53v-off,target=/vscode,type=volume'],
    });
    try {
      const {name, containerId} = await opened(folder);
      const mount = await vscodeMountOf(containerId);
      const volumes = await volumeNames();
      await closeWindow(name);
      deepStrictEqual(
        [mount?.[1], volumes.includes('vscode'), volumes.includes('c53v-off')],
        ['c53v-off', false, true],
      );
    } finally {
      await setUserSetting('dev.containers.cacheVolume', undefined);
      await removeContainers(folder);
      await docker('volume', 'rm', '--force', 'c53v-off').catch(
        () => undefined,
      );
    }
  });

  it('F-0419 AC-15 (c15): the connect looks the same with cacheVolume on and off: the same toasts, the same indicator, and the same title but for the folder name', async () => {
    const looks: Look[] = [];
    for (const cacheVolume of [true, false]) {
      await setUserSetting('dev.containers.cacheVolume', cacheVolume);
      const folder = devContainerFolder('c53v-look', {name: 'Volume Look'});
      try {
        const name = await openFolderWindow(folder);
        const toasts = new Set<string>();
        const gate = {done: false};
        const sampler = (async () => {
          while (!gate.done) {
            try {
              for (const text of await notifications(name)) {
                if (text.startsWith('Connecting')) {
                  toasts.add(text);
                }
              }
            } catch {
              // The window is reloading.
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        })();
        await reopenInContainer(name);
        gate.done = true;
        await sampler;
        await waitFor(
          `window ${name}'s remote indicator to leave Opening Remote...`,
          async () =>
            !(await statusBarText(name, 'status.host')).startsWith(
              'Opening Remote',
            ),
          30_000,
        );
        looks.push({
          toasts: [...toasts].sort(),
          indicator: await statusBarText(name, 'status.host'),
          title: (await windowTitle(name)).replace(
            path.basename(folder),
            '<folder>',
          ),
        });
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    await setUserSetting('dev.containers.cacheVolume', undefined);
    deepStrictEqual(looks.map(baseOf), [
      {...baseOf(looks[0]), indicator: 'Dev Container: Volume Look'},
      {...baseOf(looks[0]), indicator: 'Dev Container: Volume Look'},
    ]);
  });

  it('F-0419 AC-17 (c17): with an extension pack to install, with cacheVolume on and off, there is a moment when the window is connected and the extensions are not all installed, and they are installed after', async () => {
    const results = [];
    for (const cacheVolume of [false, true]) {
      await setUserSetting('dev.containers.cacheVolume', cacheVolume);
      const folder = devContainerFolder('c53v-pack', {
        name: 'Volume Pack',
        customizations: {vscode: {extensions: ['vscjava.vscode-java-pack']}},
      });
      try {
        const name = await openFolderWindow(folder);
        const samples: Array<{connected: boolean; installed: number}> = [];
        const gate = {done: false};
        const sampler = (async () => {
          let settled = 0;
          while (!gate.done || settled < 20) {
            try {
              const connected = (
                await statusBarText(name, 'status.host')
              ).startsWith('Dev Container:');
              const [containerId = ''] = await devContainersOf(folder);
              const installed =
                connected && containerId !== ''
                  ? await installedCountOf(containerId)
                  : 0;
              samples.push({connected, installed});
              settled =
                gate.done && installed === samples.at(-2)?.installed
                  ? settled + 1
                  : 0;
            } catch {
              // The window is reloading.
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        })();
        await reopenInContainer(name);
        gate.done = true;
        await sampler;
        const connectedSamples = samples.filter(sample => sample.connected);
        results.push({
          cacheVolume,
          atFirstConnected: connectedSamples[0]?.installed,
          atEnd: samples.at(-1)?.installed,
        });
        await closeWindow(name);
      } finally {
        await removeContainers(folder);
      }
    }
    await setUserSetting('dev.containers.cacheVolume', undefined);
    console.log(`c53v c17: ${JSON.stringify(results)}`);
    deepStrictEqual(
      results.map(
        result => (result.atFirstConnected ?? 0) < (result.atEnd ?? 0),
      ),
      [true, true],
    );
  });

  it('F-0419 AC-4 (c105-fresh): an extension not in the shared cache is installed, a real file of the same size appears in the shared cache folder and in the container’s own cache', async () => {
    await noVscodeVolume();
    const folder = extensionFolder('c105-fresh', CACHED_EXTENSION);
    try {
      const {name, containerId} = await opened(folder);
      const file = await sharedPackageOf(containerId);
      await waitFor(
        'the extension to be installed',
        () => installedExtension(containerId, CACHED_EXTENSION),
        CACHE_FILL_MILLISECONDS,
      ).catch(() => undefined);
      const own = await ownEntriesOf(containerId);
      const sharedSize = await realFileSizeOf(
        containerId,
        `${sharedCacheFolder()}/${file}`,
      );
      const installed = await installedExtension(containerId, CACHED_EXTENSION);
      await closeWindow(name);
      deepStrictEqual(
        {
          file: file.startsWith(`${CACHED_EXTENSION}-`),
          sharedIsReal: sharedSize !== undefined && sharedSize > 0,
          ownExists: file in own,
          sameSize:
            sharedSize !== undefined &&
            sharedSize === (await resolvedSizeOfSafe(containerId, own, file)),
          installed,
        },
        {
          file: true,
          sharedIsReal: true,
          ownExists: true,
          sameSize: true,
          installed: true,
        },
        JSON.stringify(own),
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0419 AC-5 (c105-shared): a second, unrelated container with the same extension takes it from the shared cache with no second download, and its entry links to the shared copy', async () => {
    const first = extensionFolder('c105-shared-a', CACHED_EXTENSION);
    const second = extensionFolder('c105-shared-b', CACHED_EXTENSION);
    try {
      const firstOpen = await opened(first);
      const sharedFile = await sharedPackageOf(firstOpen.containerId);
      await closeWindow(firstOpen.name);
      const mark = containersLog().length;
      const secondOpen = await opened(second);
      const own = await ownEntriesOf(secondOpen.containerId);
      const lines = containersLog().slice(mark);
      await closeWindow(secondOpen.name);
      deepStrictEqual(
        {
          link: own[sharedFile],
          taken: lines.some(
            line =>
              line.includes(`the extension ${CACHED_EXTENSION}@`) &&
              line.includes('is taken from the shared cache'),
          ),
          downloaded: lines.some(line => line.includes('downloaded')),
        },
        {
          link: `${sharedCacheFolder()}/${sharedFile}`,
          taken: true,
          downloaded: false,
        },
        lines.join('\n'),
      );
    } finally {
      await removeContainers(first);
      await removeContainers(second);
    }
  });

  it('F-0419 AC-35 (glibc-then-alpine): a Debian container and then an Alpine one, on a daemon with no vscode volume, mount the same vscode volume, its server folder lists a glibc and an Alpine platform folder, each with one commit folder, and the Alpine container’s entry for the extension the first cached is a link into the shared cache', async () => {
    await noVscodeVolume();
    const glibc = devContainerFolder('c53v-glibc', {
      name: 'Volume Glibc',
      image: GLIBC_IMAGE,
      customizations: {vscode: {extensions: [CACHED_EXTENSION]}},
    });
    const alpine = devContainerFolder('c53v-alpine', {
      name: 'Volume Alpine',
      customizations: {vscode: {extensions: [CACHED_EXTENSION]}},
    });
    try {
      const glibcOpen = await opened(glibc);
      const glibcMount = await vscodeMountOf(glibcOpen.containerId);
      await sharedPackageOf(glibcOpen.containerId);
      await closeWindow(glibcOpen.name);
      const alpineOpen = await opened(alpine);
      const alpineMount = await vscodeMountOf(alpineOpen.containerId);
      const link = await serverLinkOf(alpineOpen.containerId);
      const alpineEntries = await ownEntriesOf(alpineOpen.containerId);
      const binFolder = link.replace(/\/[^/]*\/[^/]*$/, '');
      const platforms = (
        await docker('exec', alpineOpen.containerId, 'ls', binFolder)
      )
        .split('\n')
        .filter(line => line !== '');
      const commits = [];
      for (const platform of platforms) {
        commits.push(
          (
            await docker(
              'exec',
              alpineOpen.containerId,
              'ls',
              `${binFolder}/${platform}`,
            )
          )
            .split('\n')
            .filter(line => line !== '').length,
        );
      }
      await closeWindow(alpineOpen.name);
      deepStrictEqual(
        {
          mounts: [glibcMount, alpineMount],
          platforms,
          commits,
          alpineEntries: Object.values(alpineEntries).map(target =>
            target.startsWith(`${sharedCacheFolder()}/`),
          ),
        },
        {
          mounts: [
            ['volume', 'vscode', true],
            ['volume', 'vscode', true],
          ],
          platforms: [`alpine-${process.arch}`, `linux-${process.arch}`],
          commits: [1, 1],
          alpineEntries: [true],
        },
      );
    } finally {
      await removeContainers(glibc);
      await removeContainers(alpine);
    }
  });

  it('F-0419 AC-39 (c105-host-root): the server archive is in the client’s cache with either value of cacheVolume, and the extension packages are there only when cacheVolume is false', async () => {
    const clientPackages = path.join(
      tmpdir(),
      'vscode-remote-containers',
      'extensionsCache',
    );
    const archive = cachedArchiveOf(`alpine-${process.arch}`);
    const seen: Array<{
      cacheVolume: boolean;
      archive: boolean;
      packages: string[];
    }> = [];
    for (const cacheVolume of [false, true]) {
      rmSync(clientPackages, {recursive: true, force: true});
      rmSync(path.dirname(archive), {recursive: true, force: true});
      await noVscodeVolume();
      await setUserSetting('dev.containers.cacheVolume', cacheVolume);
      const folder = extensionFolder('c105-host-root', CACHED_EXTENSION);
      try {
        const {name} = await opened(folder);
        await closeWindow(name);
        seen.push({
          cacheVolume,
          archive: existsSync(archive),
          packages: existsSync(clientPackages)
            ? readdirSync(clientPackages).filter(file => file.endsWith('.vsix'))
            : [],
        });
      } finally {
        await setUserSetting('dev.containers.cacheVolume', undefined);
        await removeContainers(folder);
      }
    }
    deepStrictEqual(
      seen.map(each => [
        each.cacheVolume,
        each.archive,
        each.packages.map(file => file.startsWith(`${CACHED_EXTENSION}-`)),
      ]),
      [
        [false, true, [true]],
        [true, true, []],
      ],
      JSON.stringify(seen),
    );
  });

  it('F-0419 AC-42 (c105-reference-cache): a package of the same version in the reference’s folder is left alone, our file appears in the shared cache folder, and the container’s entry does not link into the reference’s folder', async () => {
    await noVscodeVolume();
    const first = extensionFolder('c105-ref-a', CACHED_EXTENSION);
    const second = extensionFolder('c105-ref-b', CACHED_EXTENSION);
    const reference = '/vscode/vscode-server/extensionsCache';
    try {
      const firstOpen = await opened(first);
      const file = await sharedPackageOf(firstOpen.containerId);
      const planted = await docker(
        'exec',
        '--user',
        'root',
        firstOpen.containerId,
        'sh',
        '-c',
        `rm -f '${sharedCacheFolder()}/${file}'; mkdir -p ${reference}; echo planted-by-the-reference > '${reference}/${file}'; sha256sum '${reference}/${file}'; stat -c %Y '${reference}/${file}'`,
      );
      await closeWindow(firstOpen.name);
      await removeContainers(first);
      const secondOpen = await opened(second);
      const own = await ownEntriesOf(secondOpen.containerId);
      const after = await docker(
        'exec',
        '--user',
        'root',
        secondOpen.containerId,
        'sh',
        '-c',
        `sha256sum '${reference}/${file}'; stat -c %Y '${reference}/${file}'`,
      );
      const ours = await realFileSizeOf(
        secondOpen.containerId,
        `${sharedCacheFolder()}/${file}`,
      );
      await closeWindow(secondOpen.name);
      deepStrictEqual(
        {
          ourFile: ours !== undefined && ours > 100,
          link: own[file],
          referenceUnchanged: after === planted,
        },
        {
          ourFile: true,
          link: `${sharedCacheFolder()}/${file}`,
          referenceUnchanged: true,
        },
      );
    } finally {
      await removeContainers(first);
      await removeContainers(second);
    }
  });

  it('F-0505 AC-21 (c105-offline): in a container with no network an extension not in the shared cache is installed within a few seconds, with no notification, dialog or Problems entry', async () => {
    await noVscodeVolume();
    const folder = devContainerFolder('c105-offline', {
      name: 'Offline',
      runArgs: [...runLabelArguments(), '--network', 'none'],
      customizations: {vscode: {extensions: [OFFLINE_EXTENSION]}},
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const connected = Date.now();
      await waitFor(
        'the extension to be installed',
        () => installedExtension(containerId, OFFLINE_EXTENSION),
        60_000,
      ).catch(() => undefined);
      const seconds = (Date.now() - connected) / 1000;
      deepStrictEqual(
        {
          installed: await installedExtension(containerId, OFFLINE_EXTENSION),
          fewSeconds: seconds <= 10,
          notices: (await notifications(name)).filter(text =>
            text.toLowerCase().includes('extension'),
          ),
          dialog: await dialogOf(name),
          problems: await problemsOf(name),
        },
        {
          installed: true,
          fewSeconds: true,
          notices: [],
          dialog: undefined,
          problems: [],
        },
        `${String(seconds)} s`,
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('containers-130 (c130-bad-cache): F-0503 5.0 step 5, a cached archive that holds the wrong server fails the connect at once with F-0410’s dialog, is removed, and Retry downloads the right one and connects', async () => {
    await docker('volume', 'rm', '--force', 'vscode');
    const planted = cachedArchiveOf('linux-x64');
    mkdirSync(path.dirname(planted), {recursive: true});
    copyFileSync(pinnedAlpineArchive(), planted);
    const folder = devContainerFolder('c130-bad-cache', {
      name: 'Bad Cache',
      image: GLIBC_IMAGE,
    });
    try {
      const name = await openFolderWindow(folder);
      const started = Date.now();
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 30_000);
      const shownAfter = Date.now() - started;
      const goneAtDialog = !existsSync(planted);
      const before = downloadRequests().length;
      await answerDialog(name, 'Retry');
      await connectedToContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const requests = downloadRequests().slice(before);
      deepStrictEqual(
        {
          dialog: [dialog.details, [...dialog.buttons].sort()],
          withinThirtySeconds: shownAfter < 30_000,
          goneAtDialog,
          nodeRuns: (
            await docker(
              'exec',
              containerId,
              'sh',
              '-c',
              '"$(dirname "$(readlink -f "$HOME"/.*-server*/bin/*/node)")"/node --version',
            )
          ).startsWith('v'),
          downloaded: requests.filter(line => line.includes('linux-x64'))
            .length,
          cacheRefilled: existsSync(planted),
        },
        {
          dialog: [
            S034,
            ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
          ],
          withinThirtySeconds: true,
          goneAtDialog: true,
          nodeRuns: true,
          downloaded: 1,
          cacheRefilled: true,
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('tooling-77 (reset-removes): a reset leaves no dev.containers.cacheVolume key in the user settings', async () => {
    const seen: Array<[boolean, boolean]> = [];
    for (const value of [false, undefined]) {
      await setUserSetting('dev.containers.cacheVolume', value);
      seen.push([
        settingsText().includes('"dev.containers.cacheVolume"'),
        await userScopeHolds('local', 'dev.containers.cacheVolume'),
      ]);
    }
    deepStrictEqual(seen, [
      [true, true],
      [false, false],
    ]);
  });
});
