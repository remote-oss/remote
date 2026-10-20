import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {volumeServerFolder} from 'lib-product';
import {
  activeEditorOf,
  closeWindow,
  devContainerFolder,
  connectedToContainer,
  devContainersOf,
  editorProduct,
  OLD_GLIBC_IMAGE,
  reopenInContainer,
  reopenStarted,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  pressEscape,
  quickPickOf,
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

/** What the connect's progress notification says while the server is installed and then started (S209, S334). */
const INSTALLING = 'Installing server';

const STARTING = 'Starting server';

/** The notice text of S157, which no dialog or notification of a failed download may show. */
const S157 = 'Waiting for other windows to connect';

/** The recovery quick pick's placeholder (S272). */
const S272 = 'Pick an action to help resolve the problem.';

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

/** Removes the images the dev container CLI built for the folder named `folderName`, which carry its name. */
async function removeImagesOf(folderName: string): Promise<void> {
  const {stdout} = await execFileAsync('docker', [
    'images',
    '--quiet',
    '--filter',
    `reference=vsc-${folderName}-*`,
  ]);
  const images = [...new Set(stdout.split('\n').filter(line => line !== ''))];
  if (images.length > 0) {
    await execFileAsync('docker', ['rmi', '--force', ...images]);
  }
}

/** What `script` prints when run as `user` (root unless said) in container `containerId`. */
async function inContainer(
  containerId: string,
  script: string,
  user = 'root',
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    '--user',
    user,
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
      await removeImagesOf('c41-mount-user');
    }
  });

  /** The failing source of the run's download host: its `missing` segment answers 404. */
  const failingSource = `${variable('HARNESS_DOWNLOADS_LOCAL')}/missing`;

  const workingSource = `${variable('HARNESS_DOWNLOADS_LOCAL')}/ok`;

  /**
   * Runs `body` with an empty volume tree, an empty download folder of its own and the failing source set, and puts the
   * launch's settings back after.
   */
  async function withFailingSource(
    body: (folder: string, downloads: string) => Promise<void>,
  ): Promise<void> {
    await removeTree();
    const downloads = path.join(variable('HARNESS_RUN_FOLDER'), 'c41-failing');
    mkdirSync(downloads, {recursive: true});
    await setUserSetting('remote.serverDownloadFolder', downloads);
    await setUserSetting('remote.serverDownloadBaseUrl', failingSource);
    try {
      await body(folderOf('c41-failing'), downloads);
    } finally {
      await setUserSetting('remote.serverDownloadBaseUrl', workingSource);
      await setUserSetting('remote.serverDownloadFolder', downloadFolder);
    }
  }

  /** The text of the failure dialog, as `message`, `details` and `buttons`. */
  async function failureDialog(name: string): Promise<{
    message: string;
    details: string;
    buttons: string[];
  }> {
    const dialog = await waitForDialog(name, 180_000);
    return {
      message: dialog.message,
      details: dialog.details,
      buttons: [...dialog.buttons],
    };
  }

  const FAILED_SETUP = {
    message: '',
    details: S034,
    buttons: ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
  };

  it('F-0503 AC-19 (s9): a source that answers 404 shows the generic dialog with Retry, no S157 notification, and leaves the container running', async () => {
    await withFailingSource(async folder => {
      const name = await openFolderWindow(folder);
      opened.push(name);
      const shown = new Set<string>();
      const watch = {done: false};
      const polling = (async () => {
        while (!watch.done) {
          for (const text of await notifications(name).catch(() => [])) {
            shown.add(text);
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      })();
      const before = requestCount();
      await reopenStarted(name);
      const dialog = await failureDialog(name);
      watch.done = true;
      await polling;
      const containerIds = await devContainersOf(folder);
      const {stdout} = await execFileAsync('docker', [
        'inspect',
        '-f',
        '{{.State.Status}}',
        containerIds[0] ?? '',
      ]);
      deepStrictEqual(
        {
          dialog,
          waiting: [...shown].some(text => text.includes(S157)),
          containers: containerIds.length,
          status: stdout.trim(),
          requests: requestsSince(before).every(request =>
            request.startsWith('GET /missing/'),
          ),
        },
        {
          dialog: FAILED_SETUP,
          waiting: false,
          containers: 1,
          status: 'running',
          requests: true,
        },
      );
    });
  });

  it('F-0503 AC-20 (s10): Retry with the cause unchanged ends in the same dialog on the same container, and Retry after the source is fixed connects it', async () => {
    await withFailingSource(async folder => {
      const name = await openFolderWindow(folder);
      opened.push(name);
      await reopenStarted(name);
      await failureDialog(name);
      const first = await devContainersOf(folder);
      await answerDialog(name, 'Retry');
      const again = await failureDialog(name);
      await setUserSetting('remote.serverDownloadBaseUrl', workingSource);
      await answerDialog(name, 'Retry');
      await connectedToContainer(name);
      deepStrictEqual(
        {
          again,
          sameContainer: [first, await devContainersOf(folder)],
        },
        {again: FAILED_SETUP, sameContainer: [first, first]},
      );
    });
  });

  it('F-0503 AC-43 (s11): the editor’s own server folder holds the install, no other server folder is made, and the download is of the editor’s quality', async () => {
    await removeTree();
    const downloads = path.join(variable('HARNESS_RUN_FOLDER'), 'c41-names');
    mkdirSync(downloads, {recursive: true});
    await setUserSetting('remote.serverDownloadFolder', downloads);
    try {
      const before = requestCount();
      const first = await connect(folderOf('c41-names'));
      const tree = await treeOfImage();
      const product = editorProduct();
      deepStrictEqual(
        {
          serverFolders: (await inContainer(first.containerId, 'ls -A ~'))
            .split('\n')
            .filter(entry => entry.startsWith('.vscod')),
          link: (await installedIn(first.containerId, tree)).link,
          request: requestsSince(before),
          archive: filesUnder(downloads).filter(file =>
            file.endsWith(`-${product.quality}.tar.gz`),
          ).length,
        },
        {
          serverFolders: [product.serverDataFolderName],
          link: tree,
          request: [
            `GET /ok/commit:${product.commit}/server-${updateServicePlatform(tree)}/${product.quality}`,
          ],
          archive: 1,
        },
      );
    } finally {
      await setUserSetting('remote.serverDownloadFolder', downloadFolder);
    }
  });

  /** The failure dialog of a connect to a container whose glibc is too old, with the window it is in. */
  async function requirementsDialog(name: string): Promise<string> {
    const folder = folderOf(name, {image: OLD_GLIBC_IMAGE});
    const window = await openFolderWindow(folder);
    opened.push(window);
    await reopenStarted(window);
    await waitForDialog(window, 180_000);
    return window;
  }

  it('F-0503 AC-6 (s12): the link is in the remote user’s own home, for root and for another remote user', async () => {
    const product = editorProduct();
    const rows: Array<[string, string]> = [];
    for (const [name, user] of [
      ['c41-home-root', 'root'],
      ['c41-home-user', 'node'],
    ] as const) {
      const connected = await connect(
        folderOf(name, user === 'root' ? {} : {remoteUser: user}),
      );
      const home = await inContainer(
        connected.containerId,
        `getent passwd ${user} | cut -d: -f6`,
      );
      rows.push([
        home,
        await inContainer(
          connected.containerId,
          `readlink ${home}/${product.serverDataFolderName}/bin/${product.commit}`,
        ),
      ]);
    }
    const tree = await treeOfImage();
    deepStrictEqual(rows, [
      ['/root', tree],
      ['/home/node', tree],
    ]);
  });

  it('F-0503 AC-9 (s13): the server’s processes run as the remote user, and it listens on 127.0.0.1 only', async () => {
    const connected = await connect(
      folderOf('c41-processes', {remoteUser: 'node'}),
    );
    const owners = (
      await inContainer(
        connected.containerId,
        `ps -o user,args | grep -E 'codium|server-main|node' | grep -v grep | cut -d' ' -f1 | sort -u`,
      )
    ).split('\n');
    const listening = (await inContainer(connected.containerId, 'netstat -ltn'))
      .split('\n')
      .filter(line => line.startsWith('tcp'))
      .map(line => line.split(/\s+/)[3]?.split(':')[0]);
    deepStrictEqual(
      [owners, [...new Set(listening)]],
      [['node'], ['127.0.0.1']],
    );
  });

  it('F-0503 AC-10, AC-29 (s14): an Alpine container gets the Alpine tree of its architecture with no dialog, and the progress notification is gone after the connect', async () => {
    const connected = await connect(folderOf('c41-alpine'));
    await new Promise(resolve => setTimeout(resolve, 3000));
    const platform = await platformName();
    deepStrictEqual(
      {
        tree: (await installedIn(connected.containerId, await treeOfImage()))
          .productJson,
        dialog: await dialogOf(connected.name),
        connecting: (await notifications(connected.name)).filter(text =>
          text.includes('Connecting to Dev Container'),
        ),
        platform: platform.startsWith('alpine-'),
      },
      {tree: true, dialog: undefined, connecting: [], platform: true},
    );
  });

  it('F-0503 AC-11 (s15): with no network, a volume hit and a miss that needs a download both connect', async () => {
    const results: Array<[string[], string]> = [];
    for (const miss of [false, true]) {
      if (miss) {
        await removeTree();
      }
      const connected = await connect(
        folderOf(`c41-network-${miss ? 'miss' : 'hit'}`, {
          runArgs: [...runLabelArguments(), '--network', 'none'],
        }),
      );
      results.push([
        connected.phases,
        await inContainer(connected.containerId, 'ls /sys/class/net'),
      ]);
    }
    deepStrictEqual(results, [
      [[STARTING], 'lo'],
      [[INSTALLING, STARTING], 'lo'],
    ]);
  });

  it('F-0503 AC-16, AC-18 (s16): More Actions... on the requirements dialog shows the disconnected status and the five-item recovery quick pick of ruling 14, and Escape on it closes it and leaves the window disconnected', async () => {
    const window = await requirementsDialog('c41-requirements-pick');
    await answerDialog(window, 'More Actions...');
    const pick = await waitForQuickPick(window, 30_000);
    const indicator = (await statusItem(window, 'status.host')).text;
    await pressEscape(window);
    deepStrictEqual(
      {
        pick,
        indicator,
        after: [
          await dialogOf(window),
          (await statusItem(window, 'status.host')).text,
        ],
      },
      {
        pick: {
          placeholder: S272,
          items: [
            'Reload Window',
            'Rebuild Container',
            'Edit devcontainer.json Locally',
            'Open Recent...',
            'Open Documentation',
          ],
        },
        indicator: 'Disconnected from Dev Container',
        after: [undefined, 'Disconnected from Dev Container'],
      },
    );
  });

  it('F-0503 AC-17 (s17): Edit devcontainer.json Locally on the requirements dialog shows the configuration file as the active editor, with no quick pick', async () => {
    const window = await requirementsDialog('c41-requirements-edit');
    await answerDialog(window, 'Edit devcontainer.json Locally');
    const configuration = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c41-requirements-edit',
      '.devcontainer',
      'devcontainer.json',
    );
    await waitFor(
      `window ${window}'s active editor to be ${configuration}`,
      async () => (await activeEditorOf(window)) === configuration,
      10_000,
    );
    deepStrictEqual(await quickPickOf(window), undefined);
  });

  it('F-0503 AC-44 (s18): a containerEnv HOME the remote user cannot create fails the setup, and creates nothing in /opt or in the user’s own home', async () => {
    const folder = folderOf('c41-home-env', {
      remoteUser: 'node',
      containerEnv: {HOME: '/opt/r14home'},
    });
    const window = await openFolderWindow(folder);
    opened.push(window);
    await reopenStarted(window);
    const dialog = await failureDialog(window);
    const containerId = (await devContainersOf(folder))[0] ?? '';
    deepStrictEqual(
      {
        dialog,
        optional: await inContainer(containerId, 'ls -A /opt'),
        home: await inContainer(containerId, 'ls -A /home/node'),
      },
      {dialog: FAILED_SETUP, optional: '', home: ''},
    );
  });

  it('F-0503 AC-45 (s19): a remoteEnv HOME does not move the server folder, which stays in the remote user’s passwd home, and the HOME path is not made', async () => {
    const product = editorProduct();
    const connected = await connect(
      folderOf('c41-remote-env', {
        remoteUser: 'node',
        remoteEnv: {HOME: '/opt/r14renv'},
      }),
    );
    const tree = await treeOfImage();
    deepStrictEqual(
      {
        link: await inContainer(
          connected.containerId,
          `readlink /home/node/${product.serverDataFolderName}/bin/${product.commit}`,
        ),
        optional: await inContainer(connected.containerId, 'ls -A /opt'),
      },
      {link: tree, optional: ''},
    );
  });
});
