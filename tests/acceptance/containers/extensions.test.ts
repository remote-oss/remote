import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  inWindow,
  reloadingCommand,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  extensionStatusShown,
  notificationCentre,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** How long the install may take after the window is connected: the window does not wait for it (F-0505 BR-8). */
const INSTALL_MILLISECONDS = 90_000;

/** The folder of the extension the configuration lists. */
const DRACULA_ID = 'dracula-theme.theme-dracula';

const DRACULA_PREFIX = `${DRACULA_ID}-`;

/** The display name Open VSX gives dracula, which the Extensions view lists it under. */
const DRACULA_NAME = 'Dracula Theme Official';

/** The YAML extension, whose newest pre-release is newer than its newest stable version on Open VSX. */
const YAML_ID = 'redhat.vscode-yaml';

const YAML_PREFIX = `${YAML_ID}-`;

/** The newest stable version of the YAML extension on Open VSX when this row was written; its pre-releases are newer. */
const STABLE_YAML = '2.0.0';

/** What the editor appends to the folder of an extension that is not built for a platform. */
const UNIVERSAL = '-universal';

/** The folders of the extensions installed in container `containerId` for the remote user; none while there is no folder. */
async function installedIn(containerId: string): Promise<string[]> {
  try {
    const {stdout} = await execFileAsync('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      `ls "$(cd; pwd)/${editorProduct().serverDataFolderName}/extensions"`,
    ]);
    return stdout.split('\n').filter(entry => entry !== '');
  } catch {
    return [];
  }
}

describe('the configuration’s extensions in the container (card containers-16)', function () {
  this.timeout(600_000);

  it('F-0505 AC-1, AC-12, AC-34 (gate-row-12): an id of the configuration is installed in the new container without holding the window, and a malformed id beside it is no notice', async () => {
    const folder = devContainerFolder('gate-extensions', {
      customizations: {
        vscode: {extensions: ['dracula-theme.theme-dracula', 'not-an-id']},
      },
    });
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    const connectedAt = Date.now();
    const [containerId = ''] = await devContainersOf(folder);
    await waitFor(
      'the extension folder of dracula-theme.theme-dracula',
      async () =>
        (await installedIn(containerId)).some(entry =>
          entry.startsWith(DRACULA_PREFIX),
        ),
      INSTALL_MILLISECONDS,
    );
    console.log(
      `containers-16 row 12: the window was connected ${String(Date.now() - connectedAt)} ms before the extension folder existed`,
    );
    const installed = await installedIn(containerId);
    const notices = await notificationCentre(name);
    await closeWindow(name);
    deepStrictEqual(
      [
        installed.filter(entry => entry.startsWith(DRACULA_PREFIX)).length,
        notices,
      ],
      [1, []],
    );
  });

  /** The latest stable version of dracula on Open VSX, which an unpinned id installs. */
  async function latestDracula(): Promise<string> {
    return openVsxVersion('dracula-theme/theme-dracula');
  }

  /** The `version` field of Open VSX's answer for `path`, read when the row runs. */
  async function openVsxVersion(path: string): Promise<string> {
    const answer = await fetch(`https://open-vsx.org/api/${path}`);
    return ((await answer.json()) as {version: string}).version;
  }

  /** Opens `folder`, reopens it in its container and gives the window and the container's id. */
  async function connected(
    folder: string,
  ): Promise<{name: string; containerId: string}> {
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    const [containerId = ''] = await devContainersOf(folder);
    return {name, containerId};
  }

  /** Waits until the folders installed in `containerId` satisfy `ready`, and gives them. */
  async function installedWhen(
    containerId: string,
    ready: (folders: string[]) => boolean,
  ): Promise<string[]> {
    await waitFor(
      'the extension folders',
      async () => ready(await installedIn(containerId)),
      INSTALL_MILLISECONDS,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    return installedIn(containerId);
  }

  /** The folders of `folders` that begin with `prefix`. */
  function startingWith(folders: string[], prefix: string): string[] {
    return folders.filter(entry => entry.startsWith(prefix));
  }

  it('F-0505 AC-2 (c66-pin): an id suffixed with an exact version installs exactly that version', async () => {
    const folder = devContainerFolder('c66-pin', {
      customizations: {vscode: {extensions: [`${DRACULA_ID}@2.24.2`]}},
    });
    try {
      const {name, containerId} = await connected(folder);
      const installed = await installedWhen(
        containerId,
        folders => startingWith(folders, DRACULA_PREFIX).length > 0,
      );
      await closeWindow(name);
      deepStrictEqual(startingWith(installed, DRACULA_PREFIX), [
        `${DRACULA_PREFIX}2.24.2${UNIVERSAL}`,
      ]);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0505 AC-3 (c66-prerelease): an id suffixed with @prerelease installs the latest pre-release when the extension has one, newer than its stable version, and the latest version when it has none', async () => {
    const folder = devContainerFolder('c66-prerelease', {
      customizations: {
        vscode: {
          extensions: [`${YAML_ID}@prerelease`, `${DRACULA_ID}@prerelease`],
        },
      },
    });
    try {
      const prerelease = await openVsxVersion(
        `${YAML_ID.replace('.', '/')}/pre-release`,
      );
      const latest = await latestDracula();
      const {name, containerId} = await connected(folder);
      const installed = await installedWhen(
        containerId,
        folders =>
          startingWith(folders, YAML_PREFIX).length > 0 &&
          startingWith(folders, DRACULA_PREFIX).length > 0,
      );
      await closeWindow(name);
      deepStrictEqual(
        [
          startingWith(installed, YAML_PREFIX),
          startingWith(installed, DRACULA_PREFIX),
          prerelease === STABLE_YAML,
        ],
        [
          [`${YAML_PREFIX}${prerelease}${UNIVERSAL}`],
          [`${DRACULA_PREFIX}${latest}${UNIVERSAL}`],
          false,
        ],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0505 AC-5 (c66-default): an id of dev.containers.defaultExtensions is installed in a container whose configuration lists none', async () => {
    const folder = devContainerFolder('c66-default');
    await setUserSetting('dev.containers.defaultExtensions', [DRACULA_ID]);
    try {
      const {name, containerId} = await connected(folder);
      const installed = await installedWhen(
        containerId,
        folders => startingWith(folders, DRACULA_PREFIX).length > 0,
      );
      await closeWindow(name);
      deepStrictEqual(startingWith(installed, DRACULA_PREFIX).length, 1);
    } finally {
      await setUserSetting('dev.containers.defaultExtensions', undefined);
      await removeContainers(folder);
    }
  });

  it('F-0505 AC-8 (c66-deprecated): the deprecated top-level extensions list alone installs its ids', async () => {
    const folder = devContainerFolder('c66-deprecated', {
      extensions: [DRACULA_ID],
    });
    try {
      const {name, containerId} = await connected(folder);
      const installed = await installedWhen(
        containerId,
        folders => startingWith(folders, DRACULA_PREFIX).length > 0,
      );
      await closeWindow(name);
      deepStrictEqual(startingWith(installed, DRACULA_PREFIX).length, 1);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0505 AC-9 (c66-both): the top-level extensions and customizations.vscode.extensions with different ids install all of them', async () => {
    const folder = devContainerFolder('c66-both', {
      extensions: [DRACULA_ID],
      customizations: {vscode: {extensions: [YAML_ID]}},
    });
    try {
      const {name, containerId} = await connected(folder);
      const installed = await installedWhen(
        containerId,
        folders =>
          startingWith(folders, DRACULA_PREFIX).length > 0 &&
          startingWith(folders, YAML_PREFIX).length > 0,
      );
      await closeWindow(name);
      deepStrictEqual(
        [
          startingWith(installed, DRACULA_PREFIX).length,
          startingWith(installed, YAML_PREFIX).length,
        ],
        [1, 1],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0505 AC-11 (c66-unpublished): an id with a version that was never published installs nothing and shows no notification, dialog or Extensions-view indicator', async () => {
    const folder = devContainerFolder('c66-unpublished', {
      customizations: {vscode: {extensions: [`${DRACULA_ID}@0.0.1`]}},
    });
    try {
      const {name, containerId} = await connected(folder);
      await new Promise(resolve => setTimeout(resolve, 20_000));
      await inWindow(name, 'workbench.view.extensions');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const result = [
        startingWith(await installedIn(containerId), DRACULA_PREFIX),
        await notificationCentre(name),
        await dialogOf(name),
        await extensionStatusShown(name, DRACULA_NAME),
      ];
      await closeWindow(name);
      deepStrictEqual(result, [[], [], undefined, undefined]);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0505 AC-13 (c66-later-source): an unpinned dev.containers.defaultExtensions entry replaces a devcontainer.json pin of the same id without a notification', async () => {
    const folder = devContainerFolder('c66-later-source', {
      customizations: {vscode: {extensions: [`${DRACULA_ID}@2.24.2`]}},
    });
    await setUserSetting('dev.containers.defaultExtensions', [DRACULA_ID]);
    try {
      const latest = await latestDracula();
      const {name, containerId} = await connected(folder);
      const installed = await installedWhen(
        containerId,
        folders => startingWith(folders, DRACULA_PREFIX).length > 0,
      );
      const notices = await notificationCentre(name);
      await closeWindow(name);
      deepStrictEqual(
        [startingWith(installed, DRACULA_PREFIX), notices],
        [[`${DRACULA_PREFIX}${latest}${UNIVERSAL}`], []],
      );
    } finally {
      await setUserSetting('dev.containers.defaultExtensions', undefined);
      await removeContainers(folder);
    }
  });

  /**
   * Makes the container of `folder` with dracula installed, closes its window, edits the list to the YAML extension and
   * reopens the folder in a container, which is the existing one. By brief-release-1 ruling 15 no prompt is looked for.
   */
  async function reopenedAfterEdit(
    folder: string,
  ): Promise<{name: string; before: string; containerId: string}> {
    const first = await connected(folder);
    await installedWhen(
      first.containerId,
      folders => startingWith(folders, DRACULA_PREFIX).length > 0,
    );
    await closeWindow(first.name);
    const file = path.join(folder, '.devcontainer', 'devcontainer.json');
    writeFileSync(
      file,
      JSON.stringify({
        ...(JSON.parse(readFileSync(file, 'utf8')) as object),
        customizations: {vscode: {extensions: [YAML_ID]}},
      }),
    );
    const second = await connected(folder);
    return {
      name: second.name,
      before: first.containerId,
      containerId: second.containerId,
    };
  }

  it('F-0505 AC-14 (c66-ignore): by ruling 15, a reopen after the extension list was edited, with no rebuild, reuses the container and adds, removes and changes no extension', async () => {
    const folder = devContainerFolder('c66-ignore', {
      customizations: {vscode: {extensions: [DRACULA_ID]}},
    });
    try {
      const {name, before, containerId} = await reopenedAfterEdit(folder);
      await new Promise(resolve => setTimeout(resolve, 20_000));
      const installed = await installedIn(containerId);
      await closeWindow(name);
      deepStrictEqual(
        [
          containerId === before,
          startingWith(installed, YAML_PREFIX),
          startingWith(installed, DRACULA_PREFIX).length,
        ],
        [true, [], 1],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0505 AC-15 (c66-rebuild): by ruling 15, rebuilding the container after the extension list was edited makes a new container that installs the current list and not dracula', async () => {
    const folder = devContainerFolder('c66-rebuild', {
      customizations: {vscode: {extensions: [DRACULA_ID]}},
    });
    try {
      const {name, before} = await reopenedAfterEdit(folder);
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      let rebuilt = '';
      await waitFor(
        'the rebuild to make a new container',
        async () => {
          const containerIds = await devContainersOf(folder);
          rebuilt = containerIds.find(each => each !== before) ?? '';
          return rebuilt !== '' && containerIds.length === 1;
        },
        240_000,
      );
      await connectedToContainer(name, 240_000);
      const installed = await installedWhen(
        rebuilt,
        folders => startingWith(folders, YAML_PREFIX).length > 0,
      );
      await closeWindow(name);
      deepStrictEqual(
        [
          startingWith(installed, DRACULA_PREFIX),
          startingWith(installed, YAML_PREFIX).length,
        ],
        [[], 1],
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
