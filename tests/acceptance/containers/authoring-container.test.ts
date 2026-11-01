import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  chooseQuickPickRow,
  detailedQuickPickRows,
  dialogKindOf,
  dialogOf,
  editorTabs,
  notificationCentre,
  paletteRows,
  pressEscape,
  quickPickFacts,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {activations} from '../windows/folder-windows.ts';
import {
  ADD_ITEM,
  ALPINE_OPTION,
  chooseUserData,
  chooseWorkspace,
  CONFIGURATION,
  closeScreen,
  indicatorMenu,
  rowsOf,
  slotNames,
  startCommand,
  startFromPalette,
  storeRoot,
  takeFeatureScreen,
  takeOptionScreen,
} from '../windows/authoring-support.ts';

const execFileAsync = promisify(execFile);

/** The start of the reopen notification, which a dev container window must not get. */
const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** Runs `work` in a window connected to a dev container over a folder with a configuration on the run's image. */
async function inContainerWindow(
  name: string,
  work: (window: string, folder: string) => Promise<void>,
): Promise<void> {
  const folder = devContainerFolder(name, {name: 'Authoring Container'});
  const window = await openFolderWindow(folder);
  try {
    await reopenInContainer(window);
    await work(window, folder);
  } finally {
    await closeWindow(window).catch(() => undefined);
    await removeContainers(folder);
  }
}

describe('the authoring command in a dev container window (card containers-126)', function () {
  this.timeout(900_000);

  it('F-0801 AC-1 (c126-dev-container): the palette lists the command in a dev container window, whose remote indicator menu, as the reference’s, does not hold it', async () => {
    await inContainerWindow('c126-menu', async window => {
      const menu = await indicatorMenu(window);
      deepStrictEqual(
        [
          menu.includes(ADD_ITEM),
          (
            await paletteRows(window, 'Add Dev Container Configuration')
          ).includes(`Dev Containers: ${ADD_ITEM}`),
        ],
        [false, true],
      );
    });
  });

  it('F-0801 AC-3 (c126-dev-container): the command of a dev container window opens a non-modal pick with the title, the placeholder, the two rows with their second lines and no buttons, the first focused and saying the configuration exists; Escape closes it and writes nothing', async () => {
    await inContainerWindow('c126-location', async (window, folder) => {
      const file = path.join(folder, CONFIGURATION);
      const configuration = readFileSync(file, 'utf8');
      const slots = slotNames();
      await startCommand(window);
      await waitForQuickPick(window);
      const facts = await quickPickFacts(window);
      const rows = await rowsOf(window);
      const buttons = (await detailedQuickPickRows(window)).map(
        each => each.buttons,
      );
      await closeScreen(window);
      deepStrictEqual(
        [
          facts,
          rows,
          buttons,
          readFileSync(file, 'utf8') === configuration,
          slotNames(),
          await dialogOf(window),
        ],
        [
          {
            title: 'Add Dev Container Configuration Files',
            placeholder:
              'Where would you like to create your container configuration?',
            titleButtons: [],
            multiSelect: false,
          },
          [
            [
              'Add configuration to workspace',
              'Configuration already exists',
              'This allows you to share the configuration with others via source control',
              true,
            ],
            [
              'Add configuration to user data folder',
              '',
              'This avoids having outgoing changes in your workspace folder',
              false,
            ],
          ],
          [[], []],
          true,
          slots,
          undefined,
        ],
      );
    });
  });

  it('F-0801 AC-14 (c126-workspace): the workspace choice replaces the configuration of the mounted folder with the template’s after the S182 question, opens it in a preview, and shows no reload and no reopen notification', async () => {
    await inContainerWindow('c126-workspace', async (window, folder) => {
      const activated = activations(window);
      await startCommand(window);
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, ALPINE_OPTION);
      await takeFeatureScreen(window);
      const asked = await waitForDialog(window, 30_000);
      await answerDialog(window, 'Overwrite');
      const file = path.join(folder, CONFIGURATION);
      await waitFor(
        'the configuration to be the template’s',
        () => readFileSync(file, 'utf8').includes('base:alpine'),
        60_000,
      );
      // The reopen notification would show within a few seconds of the write.
      await new Promise(resolve => setTimeout(resolve, 10_000));
      deepStrictEqual(
        {
          asked: [asked.details, [...asked.buttons].sort()],
          reloads: activations(window) - activated,
          preview: (await editorTabs(window)).find(
            each => each.label === 'devcontainer',
          )?.preview,
          notice: (await notificationCentre(window)).filter(text =>
            text.startsWith(NOTICE_START),
          ),
        },
        {
          asked: [
            "File './.devcontainer/devcontainer.json' already exists, overwrite?",
            ['Cancel', 'Overwrite', 'Skip'],
          ],
          reloads: 0,
          preview: true,
          notice: [],
        },
      );
    });
  });

  it('F-0801 AC-14 (c126-user-data): the user data choice, run from the palette, shows core’s dialog for the command’s error after the template screens, and nothing is created in the store, on the host or in the container, and the command runs again', async () => {
    await inContainerWindow('c126-user-data', async (window, folder) => {
      const before = slotNames();
      await startFromPalette(window);
      await chooseUserData(window);
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, ALPINE_OPTION);
      await takeFeatureScreen(window);
      const dialog = await waitForDialog(window, 30_000);
      const kind = await dialogKindOf(window);
      const [containerId = ''] = await devContainersOf(folder);
      const slot = path.join(storeRoot(), 'c126-user-data');
      const inContainer = await execFileAsync('docker', [
        'exec',
        containerId,
        'test',
        '-e',
        slot,
      ]).then(
        () => 'present',
        () => 'absent',
      );
      await answerDialog(window, 'OK');
      await startFromPalette(window);
      await pressEscape(window);
      deepStrictEqual(
        {
          dialog: [
            dialog.message,
            dialog.details.startsWith("permission denied, mkdir '") &&
              dialog.details.includes('/configs/c126-user-data'),
            [...dialog.buttons],
            kind,
          ],
          slots: slotNames(),
          slotOnHost: existsSync(slot),
          inContainer,
        },
        {
          dialog: [
            "Command 'Dev Containers: Add Dev Container Configuration Files...' resulted in an error",
            true,
            ['OK'],
            'error',
          ],
          slots: before,
          slotOnHost: false,
          inContainer: 'absent',
        },
      );
    });
  });
});
