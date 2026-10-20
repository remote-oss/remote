import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  activeEditorOf,
  closeWindow,
  devContainersOf,
  inWindow,
  runLabelArguments,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  editorTabs,
  chooseQuickPickItem,
  pressEscape,
  quickPickOf,
  quickPickRows,
  type ShownDialog,
  statusItem,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

describe('F-0301 configuration errors (card containers-50)', function () {
  this.timeout(900_000);
  const opened: string[] = [];
  const folders: string[] = [];

  function configFolder(
    name: string,
    files: Readonly<Record<string, Record<string, unknown> | string>>,
  ): string {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(folder, relative);
      mkdirSync(path.dirname(file), {recursive: true});
      writeFileSync(
        file,
        typeof content === 'string'
          ? content
          : JSON.stringify({
              image: variable('HARNESS_DEVCONTAINER_IMAGE'),
              runArgs: runLabelArguments(),
              ...content,
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

  /** Opens `folder`'s window and runs Reopen in Container, which waits on its dialog; returns the dialog with the command. */
  async function reopenToDialog(folder: string): Promise<{
    window: string;
    running: Promise<unknown>;
    dialog: ShownDialog;
  }> {
    const window = await openFolderWindow(folder);
    opened.push(window);
    const running = inWindow(window, 'remote-containers.reopenInContainer');
    return {window, running, dialog: await waitForDialog(window, 120_000)};
  }

  /** The dialog's detail and buttons. */
  function sayingOf(dialog: ShownDialog): {details: string; buttons: string[]} {
    return {details: dialog.details, buttons: [...dialog.buttons]};
  }

  const FAILED_SETUP = {
    details: 'An error occurred setting up the container.',
    buttons: ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
  };

  /** The configuration of a folder whose `image` is a number, which the connect rejects before the CLI runs. */
  const NUMBER_IMAGE = {name: 'Bad', image: 42};

  it('F-0301 AC-9, AC-53 (e1): an empty configuration file shows the read-failure dialog with the file open behind it, and Show Log closes the dialog and leaves the file open and the window local', async () => {
    const folder = configFolder('c50-empty', {
      '.devcontainer/devcontainer.json': '',
    });
    const shown = await reopenToDialog(folder);
    const behind = await editorTabs(shown.window);
    await answerDialog(shown.window, 'Show Log');
    await shown.running.catch(() => undefined);
    deepStrictEqual(
      {
        dialog: {
          details:
            "Failed to read Dev Container configuration '.devcontainer/devcontainer.json' file.",
          buttons: ['Cancel', 'Show Log'],
        },
        behind: behind.map(entry => [entry.label, entry.active, entry.preview]),
        after: [
          await dialogOf(shown.window),
          (await editorTabs(shown.window)).map(entry => [
            entry.label,
            entry.preview,
          ]),
          (await windowState(shown.window)).remoteName,
          await devContainersOf(folder),
        ],
      },
      {
        dialog: sayingOf(shown.dialog),
        behind: [['devcontainer', true, true]],
        after: [undefined, [['devcontainer', true]], null, []],
      },
    );
  });

  it("F-0301 AC-11, AC-55, AC-56 (e2): an image that is a number shows S081 with the configuration's path and makes no container, the title is unchanged while it is open, and More Actions... shows the four-item pick and then the disconnected title and status", async () => {
    const folder = configFolder('c50-number', {
      '.devcontainer/devcontainer.json': NUMBER_IMAGE,
    });
    const before = readFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      'utf8',
    );
    const shown = await reopenToDialog(folder);
    const titleOpen = await windowTitle(shown.window);
    await answerDialog(shown.window, 'More Actions...');
    const pick = await waitForQuickPick(shown.window, 30_000);
    const rows = await quickPickRows(shown.window);
    await pressEscape(shown.window);
    await shown.running.catch(() => undefined);
    deepStrictEqual(
      {
        dialog: sayingOf(shown.dialog),
        containers: await devContainersOf(folder),
        file:
          readFileSync(
            path.join(folder, '.devcontainer', 'devcontainer.json'),
            'utf8',
          ) === before,
        titleOpen,
        placeholder: pick.placeholder,
        rows,
        after: [
          await windowTitle(shown.window),
          (await statusItem(shown.window, 'status.host')).text,
        ],
      },
      {
        dialog: {
          ...FAILED_SETUP,
          details: `Configuration "${path.join(folder, '.devcontainer', 'devcontainer.json')}" not valid.`,
        },
        containers: [],
        file: true,
        titleOpen: '[c50-number]',
        placeholder: 'Pick an action to help resolve the problem.',
        rows: [
          {label: 'Reload Window', focused: true},
          {label: 'Edit devcontainer.json Locally', focused: false},
          {label: 'Open Recent...', focused: false},
          {label: 'Open Documentation', focused: false},
        ].map(entry => ({...entry, description: '', buttons: []})),
        after: [
          '[c50-number [Dev Container]]',
          'Disconnected from Dev Container',
        ],
      },
    );
  });

  it('F-0301 AC-55, AC-56 (e3): Escape on the dialog opens the same quick pick, and Edit devcontainer.json Locally leaves the window local with the configuration open', async () => {
    const escaped = await reopenToDialog(
      configFolder('c50-number-escape', {
        '.devcontainer/devcontainer.json': NUMBER_IMAGE,
      }),
    );
    await pressEscape(escaped.window);
    const pick = await waitForQuickPick(escaped.window, 30_000);
    await pressEscape(escaped.window);
    await escaped.running.catch(() => undefined);
    const edited = await reopenToDialog(
      configFolder('c50-number-edit', {
        '.devcontainer/devcontainer.json': NUMBER_IMAGE,
      }),
    );
    await answerDialog(edited.window, 'Edit devcontainer.json Locally');
    const configuration = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c50-number-edit',
      '.devcontainer',
      'devcontainer.json',
    );
    await waitFor(
      `window ${edited.window}'s active editor to be ${configuration}`,
      async () => (await activeEditorOf(edited.window)) === configuration,
      10_000,
    );
    await edited.running.catch(() => undefined);
    deepStrictEqual(
      [
        [pick.placeholder, pick.items],
        (await windowState(edited.window)).remoteName,
        (await editorTabs(edited.window)).map(entry => entry.preview),
      ],
      [
        [
          'Pick an action to help resolve the problem.',
          [
            'Reload Window',
            'Edit devcontainer.json Locally',
            'Open Recent...',
            'Open Documentation',
          ],
        ],
        null,
        [true],
      ],
    );
  });

  it('F-0301 AC-16 (e4): a configuration whose validation fails in no dedicated way shows the generic dialog', async () => {
    const shown = await reopenToDialog(
      configFolder('c50-generic', {
        '.devcontainer/devcontainer.json': {forwardPorts: {port: 1}},
      }),
    );
    await answerDialog(shown.window, 'Edit devcontainer.json Locally');
    await shown.running.catch(() => undefined);
    deepStrictEqual(sayingOf(shown.dialog), FAILED_SETUP);
  });

  it('F-0301 AC-60 (e5): Retry on the dialog of a configuration chosen in the picker shows no picker, connects again and returns the same dialog, with no container', async () => {
    const folder = configFolder('c50-retry', {
      '.devcontainer/a/devcontainer.json': NUMBER_IMAGE,
      '.devcontainer/b/devcontainer.json': {name: 'Good'},
    });
    const window = await openFolderWindow(folder);
    opened.push(window);
    const running = inWindow(window, 'remote-containers.reopenInContainer');
    await waitForQuickPick(window, 60_000);
    await chooseQuickPickItem(window, 'Bad');
    const first = await waitForDialog(window, 120_000);
    await answerDialog(window, 'Retry');
    const second = await waitForDialog(window, 120_000);
    await running.catch(() => undefined);
    deepStrictEqual(
      {
        dialogs: [sayingOf(first), sayingOf(second)],
        picker: await quickPickOf(window),
        containers: await devContainersOf(folder),
      },
      {
        dialogs: [
          {
            ...FAILED_SETUP,
            details: `Configuration "${path.join(folder, '.devcontainer', 'a', 'devcontainer.json')}" not valid.`,
          },
          {
            ...FAILED_SETUP,
            details: `Configuration "${path.join(folder, '.devcontainer', 'a', 'devcontainer.json')}" not valid.`,
          },
        ],
        picker: undefined,
        containers: [],
      },
    );
  });
});
