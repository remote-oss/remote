import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {volumeServerFolder} from 'lib-product';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  reopenInContainer,
  reopenStarted,
  variable,
} from '../windows/harness.ts';
import {notifications, waitForDialog} from '../windows/renderer.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** What the connect's progress notification says while the server is installed and then started (S209, S334). */
const INSTALLING = 'Installing server';

const STARTING = 'Starting server';

/** The generic failure dialog's detail (S034). */
const S034 = 'An error occurred setting up the container.';

/** The command that runs a script in a container of the run's image, as root, with the `vscode` volume mounted. */
async function inVolume(script: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '--rm',
    '-v',
    'vscode:/vscode',
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sh',
    '-c',
    script,
  ]);
  return stdout;
}

/** The server folder of the run's editor on the `vscode` volume, as lib-product names it. */
function volumeFolder(): string {
  return `/vscode/${volumeServerFolder(editorProduct().applicationName)}`;
}

/** The platform of the run's image, as the server names it: Alpine on the engine's architecture. */
async function platformName(): Promise<string> {
  const machine = (await inVolume('uname -m')).trim();
  return `alpine-${machine === 'aarch64' ? 'arm64' : 'x64'}`;
}

/** The tree of the run's editor's commit for the run's image on the volume. */
async function treeOfImage(): Promise<string> {
  return `${volumeFolder()}/bin/${await platformName()}/${editorProduct().commit}`;
}

/** Removes the tree of this commit and the run's image's platform from the volume, and only that: other rows share the volume. */
async function removeTree(): Promise<void> {
  await inVolume(`rm -rf ${await treeOfImage()}`);
}

/** What `script` prints when run as the remote user in container `containerId`. */
async function inContainer(
  containerId: string,
  script: string,
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'sh',
    '-c',
    script,
  ]);
  return stdout.trim();
}

/** The requests the run's download host has logged, each as its method and path. */
function requestsLogged(): string[] {
  const logFile = variable('HARNESS_DOWNLOADS_LOG');
  return (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n') : [])
    .filter(line => line !== '')
    .map(line => line.split(' ').slice(1, 3).join(' '));
}

/** The number of requests the run's download host has logged. */
function requestCount(): number {
  return requestsLogged().length;
}

/** The requests the download host logged after the first `count`. */
function requestsSince(count: number): string[] {
  return requestsLogged().slice(count);
}

/** The platform name of the base-URL form for the platform of `tree`: the update service's name, as lib-product writes it. */
function updateServicePlatform(tree: string): string {
  const platform = path.basename(path.dirname(tree));
  return platform === 'alpine-x64' ? 'linux-alpine' : platform;
}

/** The files under `folder`, relative, sorted; none when it does not exist. */
function filesUnder(folder: string): string[] {
  return existsSync(folder)
    ? (readdirSync(folder, {recursive: true}) as string[]).sort()
    : [];
}

/** What a connect showed: the progress phases in the order first seen, and the container it ended in. */
interface Connect {
  name: string;
  phases: string[];
  containerId: string;
}

describe('F-0503 server install (card containers-41)', function () {
  this.timeout(900_000);

  const opened: string[] = [];
  const folders: string[] = [];
  let downloadFolder = '';

  /** A configuration folder of the run, removed with its containers after the row. */
  function folderOf(
    name: string,
    configuration: Readonly<Record<string, unknown>> = {},
  ): string {
    const folder = devContainerFolder(name, {name, ...configuration});
    folders.push(folder);
    return folder;
  }

  /** Connects `folder` to a container, noting which of the install phases the progress notification showed. */
  async function connect(folder: string): Promise<Connect> {
    const name = await openFolderWindow(folder);
    opened.push(name);
    const phases: string[] = [];
    const watch = {done: false};
    const polling = (async () => {
      while (!watch.done) {
        for (const text of await notifications(name).catch(() => [])) {
          for (const phase of [INSTALLING, STARTING]) {
            if (text.endsWith(phase) && !phases.includes(phase)) {
              phases.push(phase);
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    })();
    try {
      await reopenInContainer(name);
    } finally {
      watch.done = true;
      await polling;
    }
    return {
      name,
      phases,
      containerId: (await devContainersOf(folder))[0] ?? '',
    };
  }

  before(async () => {
    downloadFolder = path.join(variable('HARNESS_RUN_FOLDER'), 'c41-cache');
    mkdirSync(downloadFolder, {recursive: true});
    await setUserSetting('remote.serverDownloadFolder', downloadFolder);
  });

  after(async () => {
    await setUserSetting('remote.serverDownloadFolder', undefined);
  });

  afterEach(async () => {
    for (const name of opened.splice(0)) {
      await closeWindow(name);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });

  /** Where the client keeps the archive of the commit for `tree`'s platform, relative to the download folder. */
  function archiveOf(tree: string): string {
    const product = editorProduct();
    const platform = path.basename(path.dirname(tree));
    return `${product.applicationName}/${product.quality}/${product.commit}/${product.serverApplicationName}-${platform}-${product.quality}.tar.gz`;
  }

  /** What the container's home holds for the server: where `bin/<commit>` points, and whether the tree has its product.json. */
  async function installedIn(
    containerId: string,
    tree: string,
  ): Promise<{link: string; productJson: boolean}> {
    const product = editorProduct();
    return {
      link: await inContainer(
        containerId,
        `readlink ~/${product.serverDataFolderName}/bin/${product.commit}`,
      ),
      productJson:
        (await inContainer(
          containerId,
          `test -f ${tree}/product.json && echo yes || echo no`,
        )) === 'yes',
    };
  }

  it('F-0503 AC-1, AC-5 (s1): a volume hit installs and downloads nothing, touches no cache, and the home links to the tree', async () => {
    await connect(folderOf('c41-hit-prepare'));
    await removeContainers(folderOf('c41-hit-prepare'));
    const tree = await treeOfImage();
    const requests = requestCount();
    const cache = filesUnder(downloadFolder);
    const second = await connect(folderOf('c41-hit'));
    deepStrictEqual(
      {
        phases: second.phases,
        requests: requestCount() - requests,
        cache: filesUnder(downloadFolder),
        installed: await installedIn(second.containerId, tree),
      },
      {
        phases: [STARTING],
        requests: 0,
        cache,
        installed: {link: tree, productJson: true},
      },
    );
  });

  it('F-0503 AC-2, AC-4, AC-5 (s2): a volume miss with an empty cache downloads the archive into the cache, shows Installing server then Starting server, and links the home to the new tree', async () => {
    await removeTree();
    const before = requestCount();
    const first = await connect(folderOf('c41-miss'));
    const tree = await treeOfImage();
    deepStrictEqual(
      {
        phases: first.phases,
        requests: requestsSince(before),
        archive: filesUnder(downloadFolder).includes(archiveOf(tree)),
        installed: await installedIn(first.containerId, tree),
      },
      {
        phases: [INSTALLING, STARTING],
        requests: [
          `GET /ok/commit:${editorProduct().commit}/server-${updateServicePlatform(tree)}/${editorProduct().quality}`,
        ],
        archive: true,
        installed: {link: tree, productJson: true},
      },
    );
  });

  it('F-0503 AC-3 (s3): a volume miss with the archive in the cache downloads nothing, and Installing server still shows', async () => {
    await connect(folderOf('c41-cached-prepare'));
    await removeContainers(folderOf('c41-cached-prepare'));
    const tree = await treeOfImage();
    await removeTree();
    const requests = requestCount();
    const cache = filesUnder(downloadFolder);
    const second = await connect(folderOf('c41-cached'));
    deepStrictEqual(
      {
        phases: second.phases,
        requests: requestCount() - requests,
        cache: filesUnder(downloadFolder),
        installed: await installedIn(second.containerId, await treeOfImage()),
        archive: cache.includes(archiveOf(tree)),
      },
      {
        phases: [INSTALLING, STARTING],
        requests: 0,
        cache,
        installed: {link: tree, productJson: true},
        archive: true,
      },
    );
  });

  it('F-0503 AC-7 (s4): of two unrelated workspaces on one engine only the first installs, and both homes link to the same tree', async () => {
    await removeTree();
    const first = await connect(folderOf('c41-share-a'));
    const second = await connect(folderOf('c41-share-b'));
    const tree = await treeOfImage();
    deepStrictEqual(
      {
        phases: [first.phases, second.phases],
        links: [
          (await installedIn(first.containerId, tree)).link,
          (await installedIn(second.containerId, tree)).link,
        ],
        distinct: first.containerId !== second.containerId,
      },
      {
        phases: [[INSTALLING, STARTING], [STARTING]],
        links: [tree, tree],
        distinct: true,
      },
    );
  });

  it('F-0503 AC-12 (s5): a stopped container started again keeps its id, and Installing server does not show', async () => {
    const folder = folderOf('c41-stopped');
    const first = await connect(folder);
    await closeWindow(first.name);
    opened.length = 0;
    await execFileAsync('docker', ['stop', first.containerId]);
    const requests = requestCount();
    const second = await connect(folder);
    deepStrictEqual(
      {
        sameId: second.containerId === first.containerId,
        installing: second.phases.includes(INSTALLING),
        requests: requestCount() - requests,
      },
      {sameId: true, installing: false, requests: 0},
    );
  });

  it('F-0503 AC-13 (s6): a removed container gives a new id, and Installing server does not show', async () => {
    const folder = folderOf('c41-removed');
    const first = await connect(folder);
    await closeWindow(first.name);
    opened.length = 0;
    await removeContainers(folder);
    const second = await connect(folder);
    deepStrictEqual(
      {
        newId: second.containerId !== first.containerId,
        installing: second.phases.includes(INSTALLING),
      },
      {newId: true, installing: false},
    );
  });

  it('F-0503 AC-34 (s8): a named volume on a non-root remote user’s server folder fails the setup with the generic dialog', async () => {
    const volume = `c41-home-${variable('HARNESS_RUN_ID')}`;
    const product = editorProduct();
    const folder = folderOf('c41-mount-user', {
      remoteUser: 'node',
      mounts: [
        {
          type: 'volume',
          source: volume,
          target: `/home/node/${product.serverDataFolderName}`,
        },
      ],
    });
    try {
      const name = await openFolderWindow(folder);
      opened.push(name);
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 180_000);
      deepStrictEqual(
        {
          message: dialog.message,
          details: dialog.details,
          buttons: dialog.buttons,
        },
        {
          message: '',
          details: S034,
          buttons: [
            'Edit devcontainer.json Locally',
            'More Actions...',
            'Retry',
          ],
        },
      );
    } finally {
      await removeContainers(folder);
      await execFileAsync('docker', ['volume', 'rm', '--force', volume]);
    }
  });
});
