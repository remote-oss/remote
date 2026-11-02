import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {rowsWhen} from '../windows/dev-containers-view.ts';
import {
  activeEditorOf,
  closeWindow,
  connectedToContainer,
  devContainersOf,
  devContainerFolder,
  inWindow,
  readUserSettings,
  reloadWindow,
  reopenInContainer,
  restoreUserSettings,
  runLabelArguments,
  runScopedName,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  statusItemText,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  dockerWith,
  engineSettingsAre,
  secondEngine,
  type SocketProxy,
  socketProxy,
} from '../windows/engine-fixture.ts';

/** The containers on the engine at `address` that were made for `folder`. */
async function containersOn(
  address: string,
  folder: string,
): Promise<string[]> {
  const names = await dockerWith(
    {DOCKER_HOST: address},
    'ps',
    '-aq',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
  );
  return names.split('\n').filter(each => each !== '');
}

/** The text as the editor's remote indicator shortens it: its first 40 characters and an ellipsis when it is longer. */
function shortened(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** The title and the remote indicator of the window of a folder named `name`, opened in its container. */
async function openedIn(
  name: string,
  label: string,
): Promise<{folder: string; title: string; indicator: string}> {
  const folder = devContainerFolder(name, {name: label});
  const window = await openFolderWindow(folder);
  try {
    await reopenInContainer(window);
    const title = await windowTitle(window);
    const indicator = await statusItemText(
      window,
      'status.host',
      `Dev Container: ${label}`,
      60_000,
    );
    return {folder, title, indicator};
  } finally {
    await closeWindow(window).catch(() => undefined);
    await removeContainers(folder);
  }
}

const execFileAsync = promisify(execFile);

describe('the windows of a dev container opened through the engine settings (card containers-133)', function () {
  this.timeout(900_000);

  let saved: string | undefined;
  let proxy: SocketProxy;

  before(async () => {
    saved = readUserSettings();
    proxy = await socketProxy();
  });

  after(async () => {
    restoreUserSettings(saved);
    await proxy.close();
  });

  it('F-0205 AC-38 (c133-title): the window of a container opened through a context other than default says so after the name, through a DOCKER_HOST it says the address, and through default it says nothing', async () => {
    const context = runScopedName('c133title');
    await dockerWith(
      {},
      'context',
      'create',
      context,
      '--docker',
      'host=unix:///var/run/docker.sock',
    );
    try {
      await engineSettingsAre(saved, {});
      await dockerWith({}, 'context', 'use', context);
      const throughContext = await openedIn('c133-title-context', 'Title Name');
      await dockerWith({}, 'context', 'use', 'default');
      await engineSettingsAre(saved, {'docker.host': proxy.address});
      const throughHost = await openedIn('c133-title-host', 'Title Name');
      await engineSettingsAre(saved, {});
      const throughDefault = await openedIn('c133-title-default', 'Title Name');
      deepStrictEqual(
        [
          throughContext.indicator,
          throughContext.title.includes(
            `[Dev Container: Title Name @ ${context}]`,
          ),
          throughHost.indicator,
          throughHost.title.includes(
            `[Dev Container: Title Name @ ${proxy.address}]`,
          ),
          throughDefault.indicator,
          throughDefault.title.includes(' @ '),
        ],
        [
          shortened(`Dev Container: Title Name @ ${context}`),
          true,
          shortened(`Dev Container: Title Name @ ${proxy.address}`),
          true,
          'Dev Container: Title Name',
          false,
        ],
      );
    } finally {
      await dockerWith({}, 'context', 'use', 'default').catch(() => undefined);
      await dockerWith({}, 'context', 'rm', '--force', context).catch(
        () => undefined,
      );
    }
  });

  it('F-0205 AC-51 (c133-pinned): a window opened on the engine A stays on A when the setting becomes B: its reload, its view and its rebuild use A, a lost A gives the Docker error dialog with no fallback, and a new Reopen in Container uses B', async () => {
    const shared = path.join(
      homedir(),
      '.cache',
      'remote-oss-acceptance',
      runScopedName('c133'),
    );
    const folder = path.join(shared, 'c133-pinned');
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: 'Pinned',
        image: variable('HARNESS_DEVCONTAINER_IMAGE'),
        runArgs: runLabelArguments(),
      }),
    );
    const second = await secondEngine({shared});
    const marker = runScopedName('c133aonly');
    const proxy = await socketProxy();
    try {
      await dockerWith(
        {},
        'tag',
        variable('HARNESS_DEVCONTAINER_IMAGE'),
        `${marker}:only`,
      ).catch(() => undefined);
      await execFileAsync('docker', [
        'run',
        '-d',
        ...runLabelArguments(),
        `${marker}:only`,
        'sleep',
        '3600',
      ]);
      await engineSettingsAre(saved, {'docker.host': proxy.address});
      const window = await openFolderWindow(folder);
      await reopenInContainer(window);
      const opened = await windowTitle(window);
      const firstContainers = await devContainersOf(folder);
      await engineSettingsAre(saved, {'docker.host': second.address});
      await reloadWindow(window);
      await connectedToContainer(window);
      const reloaded = await windowTitle(window);
      await inWindow(window, 'workbench.view.remote');
      const rows = await rowsWhen(window, listed =>
        listed.some(item => item.label.startsWith(marker)),
      );
      const labels = rows.map(each => each.label);
      await reopenInContainer(
        window,
        300_000,
        'remote-containers.rebuildContainer',
      );
      const rebuilt = await devContainersOf(folder);
      const secondBefore = await containersOn(second.address, folder);
      await proxy.close();
      await reloadWindow(window);
      const lost = await waitForDialog(window, 180_000);
      await answerDialog(window, 'Edit devcontainer.json Locally');
      await waitFor(
        'the configuration to be open',
        async () =>
          (await activeEditorOf(window).catch(() => null)) ===
          path.join(folder, '.devcontainer', 'devcontainer.json'),
        60_000,
      );
      await reopenInContainer(window);
      const last = await windowTitle(window);
      deepStrictEqual(
        {
          opened: opened.includes(` @ ${proxy.address}]`),
          reloaded: reloaded === opened,
          listsA: labels.some(each => each.startsWith(marker)),
          listsSecond: labels.some(each => each.startsWith(second.marker)),
          rebuiltOnA: rebuilt.length === 1 && rebuilt[0] !== firstContainers[0],
          nothingOnSecondYet: secondBefore.length,
          dialog: lost.buttons.slice().sort(),
          last: last.includes(` @ ${second.address}]`),
          onSecond: (await containersOn(second.address, folder)).length,
        },
        {
          opened: true,
          reloaded: true,
          listsA: true,
          listsSecond: false,
          rebuiltOnA: true,
          nothingOnSecondYet: 0,
          dialog: [
            'Edit devcontainer.json Locally',
            'More Actions...',
            'Retry',
          ],
          last: true,
          onSecond: 1,
        },
      );
    } finally {
      await closeWindow(path.basename(folder)).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
      await proxy.close().catch(() => undefined);
      await second.stop();
      rmSync(shared, {recursive: true, force: true});
    }
  });
});
