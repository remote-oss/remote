import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  connectedToContainer,
  devContainersOf,
  inWindow,
  isTrusted,
  runLabelArguments,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerNotification,
  chooseQuickPickItem,
  dialogOf,
  dialogText,
  notificationCentre,
  quickPickOf,
  quickPickRows,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';

/** The body the extension gives core's trust dialog, STR:S265. */
const S265 =
  'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

describe('F-0301 configurations in an untrusted folder (card containers-50)', function () {
  this.timeout(900_000);
  const opened: string[] = [];
  const folders: string[] = [];

  function configFolder(name: string, names: readonly string[]): string {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
    for (const configName of names) {
      const file = path.join(
        folder,
        '.devcontainer',
        configName.toLowerCase(),
        'devcontainer.json',
      );
      mkdirSync(path.dirname(file), {recursive: true});
      writeFileSync(
        file,
        JSON.stringify({
          name: configName,
          image: variable('HARNESS_DEVCONTAINER_IMAGE'),
          runArgs: runLabelArguments(),
        }),
      );
    }
    folders.push(folder);
    return folder;
  }

  afterEach(async () => {
    for (const window of opened.splice(0)) {
      await closeWindow(window);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });

  /** The state of an untrusted folder's window after a cancelled trust dialog: no picker, no dialog, local and restricted. */
  async function leftAlone(window: string): Promise<unknown[]> {
    return [
      await quickPickOf(window),
      await dialogOf(window),
      await isTrusted(window),
      (await windowState(window)).remoteName,
    ];
  }

  const UNTOUCHED = [undefined, undefined, false, null];

  it('F-0301 AC-59 (t1): the notification’s Reopen in Container in an untrusted folder with several configurations asks core’s trust question before any picker, and Cancel leaves the window local and restricted with no picker, message or notification', async () => {
    const folder = configFolder('c50-trust-two', ['TA', 'TB']);
    const window = await openFolderWindow(folder);
    opened.push(window);
    await answerNotification(window, NOTICE_START, 'Reopen in Container');
    const shown = await waitForDialog(window, 60_000);
    const whileOpen = [
      shown.message,
      (await dialogText(window))?.includes(S265),
      await quickPickOf(window),
    ];
    await answerDialog(window, 'Cancel');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [
        whileOpen,
        await leftAlone(window),
        (await notificationCentre(window)).filter(text =>
          text.startsWith(NOTICE_START),
        ),
        await devContainersOf(folder),
      ],
      [
        [
          'Do you trust the authors of the files in this folder?',
          true,
          undefined,
        ],
        UNTOUCHED,
        [],
        [],
      ],
    );
  });

  it('F-0301 AC-72 (t2): Rebuild and Reopen in an untrusted folder asks the trust question first, Cancel leaves the window alone, and after trust the picker lists the configurations with the first focused and a choice connects; Rebuild Without Cache gives the same picker', async () => {
    const folder = configFolder('c50-trust-rebuild', ['RB-A', 'RB-B']);
    const window = await openFolderWindow(folder);
    opened.push(window);
    const cancelled = inWindow(
      window,
      'remote-containers.rebuildAndReopenInContainer',
    );
    await waitForDialog(window, 60_000);
    await answerDialog(window, 'Cancel');
    await cancelled.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const afterCancel = await leftAlone(window);
    const again = inWindow(
      window,
      'remote-containers.rebuildAndReopenInContainer',
    );
    await waitForDialog(window, 60_000);
    await answerDialog(window, 'Trust Folder & Continue');
    await waitForQuickPick(window, 60_000);
    const rows = (await quickPickRows(window)).map(entry => [
      entry.label,
      entry.focused,
    ]);
    await chooseQuickPickItem(window, 'RB-B');
    await again.catch(() => undefined);
    await connectedToContainer(window);
    const connected = await windowTitle(window);
    await closeWindow(window);
    opened.length = 0;
    const second = await openFolderWindow(folder);
    opened.push(second);
    const noCache = inWindow(
      second,
      'remote-containers.rebuildNoCacheAndReopenInContainer',
    );
    await waitForQuickPick(second, 60_000);
    const noCacheRows = (await quickPickRows(second)).map(entry => entry.label);
    await chooseQuickPickItem(second, 'RB-A');
    await noCache.catch(() => undefined);
    await connectedToContainer(second);
    deepStrictEqual(
      [afterCancel, rows, connected, noCacheRows, await windowTitle(second)],
      [
        UNTOUCHED,
        [
          ['RB-A', true],
          ['RB-B', false],
        ],
        '[c50-trust-rebuild [Dev Container: RB-B]]',
        ['RB-A', 'RB-B'],
        '[c50-trust-rebuild [Dev Container: RB-A]]',
      ],
    );
  });
});
