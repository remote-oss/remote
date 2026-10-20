import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainersOf,
  reopenInContainer,
  inWindow,
  runLabelArguments,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  answerFolderDialog,
  chooseQuickPickItem,
  dialogOf,
  editorTabs,
  notificationCentre,
  notificationProgress,
  pageCount,
  pressEscape,
  pressQuickPickRowButton,
  quickPickOf,
  statusItem,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

describe('F-0301 workspace folders and Open Folder in Container (card containers-50)', function () {
  this.timeout(900_000);
  const opened: string[] = [];
  const folders: string[] = [];
  const execFileAsync = promisify(execFile);

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

  /** Waits until window `window` shows the configuration picker, which follows the folder dialog's own quick pick. */
  async function pickerShown(window: string): Promise<void> {
    try {
      await waitFor(
        `the configuration picker in window ${window}`,
        async () =>
          (await quickPickOf(window))?.placeholder ===
          'Select a devcontainer.json file.',
        60_000,
      );
    } catch (error) {
      const onScreen = {
        quickPick: await quickPickOf(window).catch(() => 'unreadable'),
        dialog: await dialogOf(window).catch(() => 'unreadable'),
        title: await windowTitle(window).catch(() => 'unreadable'),
      };
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; on screen: ${JSON.stringify(onScreen)}`,
        {cause: error},
      );
    }
  }

  /** Runs Open Folder in Container in window `name` without waiting for it, which a reload would end unanswered. */
  function startOpenFolder(window: string): Promise<void> {
    const running = inWindow(window, 'remote-containers.openFolder');
    running.catch(() => undefined);
    return running;
  }

  /** Opens a window of its own, which the rows start Open Folder in Container from. */
  async function startWindow(name: string): Promise<string> {
    const window = await openFolderWindow(
      configFolder(name, {'.devcontainer/devcontainer.json': {name: 'Start'}}),
    );
    opened.push(window);
    return window;
  }

  it('F-0301 AC-13 (o1): a bind workspaceMount of the folder mounts it at its target, the title names the configuration, and core says the workspace does not exist', async () => {
    const folder = configFolder('c50-mount', {
      '.devcontainer/devcontainer.json': {
        name: 'WS',
        workspaceMount:
          'source=${localWorkspaceFolder},target=/srv/f0301-ws,type=bind',
      },
    });
    const window = await openFolderWindow(folder);
    opened.push(window);
    const running = inWindow(window, 'remote-containers.reopenInContainer');
    const dialog = await waitForDialog(window, 120_000);
    const containerId = (await devContainersOf(folder))[0] ?? '';
    const {stdout} = await execFileAsync('docker', [
      'inspect',
      '-f',
      '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}={{.Destination}}{{end}}{{end}}',
      containerId,
    ]);
    const title = await windowTitle(window);
    await answerDialog(window, 'Cancel');
    await running.catch(() => undefined);
    deepStrictEqual(
      {
        dialog: {
          message: dialog.message,
          details: dialog.details,
          buttons: [...dialog.buttons],
        },
        mounts: stdout.trim(),
        title,
      },
      {
        dialog: {
          message: 'Workspace does not exist',
          details: 'Please select another workspace to open.',
          buttons: ['Cancel', 'Open Workspace...'],
        },
        mounts: `${folder}=/srv/f0301-ws`,
        title: '[c50-mount [Dev Container: WS]]',
      },
    );
  });

  it('F-0301 AC-44 (o2): a relative workspaceFolder shows the absolute-path error before any container and leaves the file and the window as they were, and after the value is made absolute, reopening that folder connects', async () => {
    const rows: unknown[] = [];
    const failed: Array<{folder: string; window: string}> = [];
    for (const [name, value] of [
      ['c50-rel-src', 'src'],
      ['c50-rel-sub', 'relative/sub/dir'],
      ['c50-rel-two', 'f0301/relative'],
    ] as const) {
      const folder = configFolder(name, {
        '.devcontainer/devcontainer.json': {
          name: 'Rel',
          workspaceFolder: value,
        },
      });
      const file = path.join(folder, '.devcontainer', 'devcontainer.json');
      const before = readFileSync(file, 'utf8');
      const window = await openFolderWindow(folder);
      opened.push(window);
      const running = inWindow(window, 'remote-containers.reopenInContainer');
      const dialog = await waitForDialog(window, 120_000);
      const whileOpen = [
        dialog.details,
        [...dialog.buttons],
        (await devContainersOf(folder)).length,
      ];
      await answerDialog(window, 'Cancel');
      await running.catch(() => undefined);
      rows.push([
        whileOpen,
        (await devContainersOf(folder)).length,
        (await windowTitle(window)).includes('[Dev Container'),
        readFileSync(file, 'utf8') === before,
      ]);
      failed.push({folder, window});
    }
    const [first] = failed;
    writeFileSync(
      path.join(first?.folder ?? '', '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        image: variable('HARNESS_DEVCONTAINER_IMAGE'),
        runArgs: runLabelArguments(),
        name: 'Rel',
        workspaceFolder: '/workspaces/c50-rel-src',
      }),
    );
    await reopenInContainer(first?.window ?? '');
    const refused = [
      [
        'Workspace folder in devcontainer.json must be an absolute path.',
        ['Cancel', 'Show Log'],
        0,
      ],
      0,
      false,
      true,
    ];
    deepStrictEqual(
      [
        rows,
        (await windowState(first?.window ?? '')).remoteName,
        (await devContainersOf(first?.folder ?? '')).length,
      ],
      [[refused, refused, refused], 'dev-container', 1],
    );
  });

  it('F-0301 AC-62 (o3): Open Folder in Container shows the target’s picker while the window shows the start folder, and the same window connects with the choice or with the only configuration, or opens a row’s file in place', async () => {
    const start = await startWindow('c50-start');
    const target = configFolder('c50-of-two', {
      '.devcontainer/a/devcontainer.json': {name: 'OF-A'},
      '.devcontainer/b/devcontainer.json': {name: 'OF-B'},
    });
    const pagesBeforeFile = await pageCount();
    const firstRun = startOpenFolder(start);
    await answerFolderDialog(start, target);
    await pickerShown(start);
    const titleAtPick = await windowTitle(start);
    await pressQuickPickRowButton(start, 'OF-A', 'Open File');
    await waitFor(
      `window ${start} to show the configuration`,
      async () => (await editorTabs(start)).some(entry => entry.preview),
      30_000,
    );
    const openedFile = {
      remoteName: (await windowState(start)).remoteName,
      title: await windowTitle(start),
      preview: (await editorTabs(start)).map(entry => entry.preview),
      pages: (await pageCount()) - pagesBeforeFile,
    };
    if ((await quickPickOf(start)) !== undefined) {
      await pressEscape(start);
    }
    await firstRun;
    const pagesBeforeChoice = await pageCount();
    void startOpenFolder(start);
    await answerFolderDialog(start, target);
    await pickerShown(start);
    await chooseQuickPickItem(start, 'OF-B');
    await connectedToContainer('c50-of-two');
    opened.splice(opened.indexOf(start), 1, 'c50-of-two');
    const pagesAfterChoice = await pageCount();
    const single = configFolder('c50-of-one', {
      '.devcontainer/devcontainer.json': {name: 'OF-ONE'},
    });
    const second = await startWindow('c50-start-two');
    const pagesBeforeSingle = await pageCount();
    void startOpenFolder(second);
    await answerFolderDialog(second, single);
    await connectedToContainer('c50-of-one');
    opened.splice(opened.indexOf(second), 1, 'c50-of-one');
    const pagesAfterSingle = await pageCount();
    deepStrictEqual(
      {
        titleAtPick,
        openedFile,
        choice: await windowTitle('c50-of-two'),
        pickerAfter: await quickPickOf('c50-of-one'),
        only: await windowTitle('c50-of-one'),
        containers: [
          (await devContainersOf(target)).length,
          (await devContainersOf(single)).length,
        ],
        noSecondWindow: [
          pagesAfterChoice === pagesBeforeChoice,
          pagesAfterSingle === pagesBeforeSingle,
        ],
      },
      {
        titleAtPick: '[c50-start [Dev Container: Start]]'.replace(
          ' [Dev Container: Start]',
          '',
        ),
        openedFile: {
          remoteName: null,
          title: '[c50-start]',
          preview: [true],
          pages: 0,
        },
        choice: '[c50-of-two [Dev Container: OF-B]]',
        pickerAfter: undefined,
        only: '[c50-of-one [Dev Container: OF-ONE]]',
        containers: [1, 1],
        noSecondWindow: [true, true],
      },
    );
  });

  it('F-0301 AC-75 (o4): Escape on the target’s picker leaves the window on its folder with no message and no container', async () => {
    const start = await startWindow('c50-start-escape');
    const target = configFolder('c50-of-escape', {
      '.devcontainer/a/devcontainer.json': {name: 'OF-A'},
      '.devcontainer/b/devcontainer.json': {name: 'OF-B'},
    });
    void startOpenFolder(start);
    await answerFolderDialog(start, target);
    await pickerShown(start);
    await pressEscape(start);
    await waitFor(
      `the picker of window ${start} to close`,
      async () => (await quickPickOf(start)) === undefined,
      10_000,
    );
    deepStrictEqual(
      {
        title: await windowTitle(start),
        remoteName: (await windowState(start)).remoteName,
        dialog: await dialogOf(start),
        centre: (await notificationCentre(start)).filter(
          text => !text.startsWith('Folder contains a Dev Container'),
        ),
        containers: await devContainersOf(target),
      },
      {
        title: '[c50-start-escape]',
        remoteName: null,
        dialog: undefined,
        centre: [],
        containers: [],
      },
    );
  });

  it('F-0301 AC-69 (o5): before the window connects, the connect shows the Connecting to Dev Container (show log) notification with an indeterminate bar and the status Opening Remote..., and the same window then reloads in place', async () => {
    const folder = configFolder('c50-connecting', {
      '.devcontainer/devcontainer.json': {name: 'Connecting'},
    });
    const window = await openFolderWindow(folder);
    opened.push(window);
    const plain = new Set<string>();
    const indicators = new Set<string>();
    const watch = {done: false};
    const sampling = (async () => {
      while (!watch.done) {
        const toast = await notificationProgress(
          window,
          'Connecting to Dev Container',
        ).catch(() => undefined);
        if (toast?.message === 'Connecting to Dev Container (show log)') {
          plain.add(toast.progress);
        }
        const indicator = await statusItem(window, 'status.host').catch(
          () => undefined,
        );
        if (indicator !== undefined) {
          indicators.add(indicator.text);
        }
        await new Promise(resolve => setTimeout(resolve, 80));
      }
    })();
    await reopenInContainer(window);
    watch.done = true;
    await sampling;
    deepStrictEqual(
      [
        [...plain],
        indicators.has('Opening Remote...'),
        (await windowState(window)).remoteName,
      ],
      [['infinite'], true, 'dev-container'],
    );
  });
});
