import {deepStrictEqual} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  terminalNames,
  waitFor,
} from '../windows/harness.ts';
import {removeContainers, openFolderWindow} from '../windows/folder-windows.ts';
import {
  answerDialog,
  answerFolderDialog,
  chooseQuickPickRow,
  primaryButtonOf,
  quickPickFacts,
  quickPickRows,
  statusItem,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';

/** The placeholder of core's Open Recent picker. */
const RECENT_PLACEHOLDER =
  'Select to open (hold Ctrl-key to force new window or Alt-key for same window)';

describe('F-0403 Open Folder in Container with an image that cannot be pulled (card coverage-71)', function () {
  this.timeout(600_000);

  it.skip('F-0403 AC-21 (c71-pull-fails): after the folder pick, a configuration whose image cannot be pulled shows the setup error with Edit devcontainer.json Locally, More Actions... and Retry as the primary button, the log terminal, and the four-item pick with Reload Window focused; Open Recent... opens core’s picker, no container exists and the configuration stays (skipped until the failure reveals the log terminal)', async () => {
    const folder = devContainerFolder('c71-pull-fails', {
      name: 'Pull Fails',
      image: 'remote-oss-acceptance-missing:none',
    });
    const starter = await openFolderWindow(devContainerFolder('c71-starter'));
    try {
      const running = inWindow(starter, 'remote-containers.openFolder');
      running.catch(() => undefined);
      await answerFolderDialog(starter, folder);
      const name = 'c71-pull-fails';
      const dialog = await waitForDialog(name, 240_000);
      const seen = {
        message: dialog.message,
        details: dialog.details,
        buttons: [...dialog.buttons].sort(),
        primary: await primaryButtonOf(name),
      };
      await new Promise(resolve => setTimeout(resolve, 5000));
      const terminals = await terminalNames(name);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      const pick = {
        placeholder: (await quickPickFacts(name))?.placeholder,
        rows: (await quickPickRows(name)).map(entry => [
          entry.label,
          entry.focused,
        ]),
        title: await windowTitle(name),
        indicator: (await statusItem(name, 'status.host')).text,
      };
      await chooseQuickPickRow(name, 'Open Recent...');
      await waitFor(
        'core’s Open Recent picker',
        async () =>
          (await quickPickFacts(name))?.placeholder === RECENT_PLACEHOLDER,
        30_000,
      );
      deepStrictEqual(
        {
          seen,
          terminals,
          pick,
          containers: await devContainersOf(folder),
          configuration: existsSync(
            path.join(folder, '.devcontainer', 'devcontainer.json'),
          ),
        },
        {
          seen: {
            message: '',
            details: 'An error occurred setting up the container.',
            buttons: [
              'Edit devcontainer.json Locally',
              'More Actions...',
              'Retry',
            ],
            primary: 'Retry',
          },
          terminals: ['remote-oss-acceptance-missing:none'],
          pick: {
            placeholder: 'Pick an action to help resolve the problem.',
            rows: [
              ['Reload Window', true],
              ['Edit devcontainer.json Locally', false],
              ['Open Recent...', false],
              ['Open Documentation', false],
            ],
            title: '[c71-pull-fails [Dev Container]]',
            indicator: 'Disconnected from Dev Container',
          },
          containers: [],
          configuration: true,
        },
      );
      await closeWindow(name);
    } finally {
      await closeWindow(starter).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
