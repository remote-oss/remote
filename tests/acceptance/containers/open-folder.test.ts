import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {
  answerDialog,
  answerFolderDialog,
  cancelFolderDialog,
  folderDialogOpen,
  notificationCentre,
  statusItem,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';

/**
 * Opens a local window on a folder of its own and gives its name. The rows start from a window with a folder because
 * the renderer helpers cannot tell two folder-less windows apart, and the local window is one already.
 */
function startWindow(name: string): Promise<string> {
  return openFolderWindow(devContainerFolder(name));
}

/** The text and label of the remote indicator of window `name`; the hover is left out, which the page reads unevenly. */
async function indicatorOf(
  name: string,
): Promise<{text: string; ariaLabel: string}> {
  const {text, ariaLabel} = await statusItem(name, 'status.host');
  return {text, ariaLabel};
}

/** Runs Open Folder in Container in window `name` without waiting for it, which a reload would end unanswered. */
function startOpenFolder(name: string): Promise<void> {
  const running = inWindow(name, 'remote-containers.openFolder');
  running.catch(() => undefined);
  return running;
}

describe('Open Folder in Container (card containers-17)', function () {
  this.timeout(600_000);

  it('F-0403 AC-1, AC-12 (open-b): from a local window, picking a configured folder reloads the window onto its dev container, once', async () => {
    const folder = devContainerFolder('open-b', {name: 'Open B'});
    const empty = await startWindow('open-from');
    void startOpenFolder(empty);
    await answerFolderDialog(empty, folder);
    await connectedToContainer('open-b');
    deepStrictEqual(
      {
        remoteName: (await windowState('open-b')).remoteName,
        title: await windowTitle('open-b'),
        containerCount: (await devContainersOf(folder)).length,
      },
      {
        remoteName: 'dev-container',
        title: '[open-b [Dev Container: Open B]]',
        containerCount: 1,
      },
    );
  });

  it('F-0403 AC-13 (open-again): picking the folder the container window shows changes nothing', async () => {
    const folder = `${variable('HARNESS_RUN_FOLDER')}/open-b`;
    const before = {
      title: await windowTitle('open-b'),
      indicator: await indicatorOf('open-b'),
      centre: await notificationCentre('open-b'),
    };
    const running = startOpenFolder('open-b');
    await answerFolderDialog('open-b', folder);
    await running;
    await new Promise(resolve => setTimeout(resolve, 5000));
    deepStrictEqual(
      {
        title: await windowTitle('open-b'),
        indicator: await indicatorOf('open-b'),
        centre: await notificationCentre('open-b'),
        containerCount: (await devContainersOf(folder)).length,
      },
      {...before, containerCount: 1},
    );
    await closeWindow('open-b');
  });

  it('F-0403 AC-14: Escape in the folder dialog leaves the window as it was and makes no container', async () => {
    const folder = devContainerFolder('open-escape');
    const empty = await startWindow('open-escape-from');
    const title = await windowTitle(empty);
    const running = startOpenFolder(empty);
    await cancelFolderDialog(empty);
    await running;
    deepStrictEqual(
      {
        title: await windowTitle(empty),
        remoteName: (await windowState(empty)).remoteName,
        containers: await devContainersOf(folder),
      },
      {title, remoteName: null, containers: []},
    );
    await closeWindow(empty);
  });

  it('F-0403 AC-20: a docker that does not exist shows the engine dialog and no folder dialog', async () => {
    const bogus = `${variable('HARNESS_RUN_FOLDER')}/no-such-docker`;
    await setUserSetting('dev.containers.dockerPath', bogus);
    try {
      const empty = await startWindow('open-docker-from');
      const running = startOpenFolder(empty);
      const shown = await waitForDialog(empty);
      await answerDialog(empty, 'Cancel');
      await running;
      deepStrictEqual(
        {
          message: shown.message,
          folderDialog: await folderDialogOpen(empty),
        },
        {
          message: 'Docker version 17.12.0 or later required.',
          folderDialog: false,
        },
      );
      await closeWindow(empty);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });
  it('F-0201 AC-56 (c74-docker-removed): in a connected window, with dockerPath changed to a missing executable, Open Folder in Container for another folder shows the Docker dialog before the picker and creates nothing, the window stays connected, and after the setting is restored the same command connects to the other folder', async () => {
    const connected = devContainerFolder('c74-removed-a', {name: 'Removed A'});
    const other = devContainerFolder('c74-removed-b', {name: 'Removed B'});
    const bogus = path.join(variable('HARNESS_RUN_FOLDER'), 'c74-removed-bin');
    const name = await openFolderWindow(connected);
    try {
      await reopenInContainer(name);
      await setUserSetting('dev.containers.dockerPath', bogus);
      void startOpenFolder(name);
      const dialog = await waitForDialog(name, 60_000);
      const whileOpen = {
        dialog: [dialog.message, dialog.details],
        picker: await folderDialogOpen(name),
      };
      await answerDialog(name, 'Cancel');
      const refused = {
        ...whileOpen,
        remoteName: (await windowState(name)).remoteName,
        created: (await devContainersOf(other)).length,
      };
      await setUserSetting('dev.containers.dockerPath', undefined);
      void startOpenFolder(name);
      await answerFolderDialog(name, other);
      await connectedToContainer('c74-removed-b');
      const restored = {
        remoteName: (await windowState('c74-removed-b')).remoteName,
        title: await windowTitle('c74-removed-b'),
        created: (await devContainersOf(other)).length,
      };
      await closeWindow('c74-removed-b');
      deepStrictEqual(
        {refused, restored},
        {
          refused: {
            dialog: [
              'Docker version 17.12.0 or later required.',
              `Command not found: '${bogus}'. Check the license for details.`,
            ],
            picker: false,
            remoteName: 'dev-container',
            created: 0,
          },
          restored: {
            remoteName: 'dev-container',
            title: '[c74-removed-b [Dev Container: Removed B]]',
            created: 1,
          },
        },
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
      await closeWindow(name).catch(() => undefined);
    }
  });
});
