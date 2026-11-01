import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainersOf,
  waitFor,
  inWindow,
  reopenInContainer,
  runLabelArguments,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  answerNotification,
  notificationCentre,
  dialogOf,
  editorTabs,
  pressEscape,
  type QuickPickRow,
  quickPickOf,
  pressQuickPickRowButton,
  quickPickRows,
  statusItem,
  waitForQuickPick,
  windowTitle,
  chooseQuickPickItem,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/**
 * The text of the remote indicator of window `name` once it is a Dev Container one and has stayed the same for three
 * seconds, so that a name the connection learns late is read; it fails after 30 s without a Dev Container text.
 */
async function settledIndicator(name: string): Promise<string> {
  await waitFor(
    `the indicator of window ${name} to read Dev Container`,
    async () =>
      (await statusItem(name, 'status.host')).text.startsWith('Dev Container'),
    30_000,
  );
  await new Promise(resolve => setTimeout(resolve, 3000));
  return (await statusItem(name, 'status.host')).text;
}

describe('F-0301 configuration discovery and picker (card containers-50)', function () {
  this.timeout(900_000);
  const opened: string[] = [];
  const folders: string[] = [];

  /** A folder of the run holding the configuration files `files` names, each on the run's image and labels. */
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

  async function open(folder: string): Promise<string> {
    const window = await openFolderWindow(folder);
    opened.push(window);
    return window;
  }

  afterEach(async () => {
    for (const window of opened.splice(0)) {
      await closeWindow(window);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });

  /** Waits until the status bar of window `name` reads a Dev Container connection, and returns its title and indicator. */
  async function connectedAs(
    window: string,
  ): Promise<{title: string; indicator: string}> {
    await waitFor(
      `window ${window} to read a Dev Container connection`,
      async () =>
        (
          await statusItem(window, 'status.host').catch(() => ({text: ''}))
        ).text.startsWith('Dev Container'),
      120_000,
    );
    return {
      title: await windowTitle(window),
      indicator: (await statusItem(window, 'status.host')).text,
    };
  }

  /** Runs Reopen in Container in `window` and returns its quick pick once shown, with the command still waiting on it. */
  async function pickOf(window: string): Promise<{
    running: Promise<unknown>;
    rows: QuickPickRow[];
    placeholder: string;
  }> {
    const running = inWindow(window, 'remote-containers.reopenInContainer');
    const shown = await waitForQuickPick(window, 60_000);
    return {
      running,
      rows: await quickPickRows(window),
      placeholder: shown.placeholder,
    };
  }

  it('F-0301 AC-1 (c1): one configuration file is used without a picker when the notification’s Reopen in Container is clicked', async () => {
    const window = await open(
      configFolder('c50-single', {
        '.devcontainer/devcontainer.json': {name: 'Single'},
      }),
    );
    await answerNotification(window, NOTICE_START, 'Reopen in Container');
    const connected = await connectedAs(window);
    deepStrictEqual(
      [await quickPickOf(window), connected],
      [
        undefined,
        {
          title: '[c50-single [Dev Container: Single]]',
          indicator: 'Dev Container: Single',
        },
      ],
    );
  });

  it('F-0301 AC-2 (c2): the root dotfile is used directly, and the connection reads Dev Container: <name>, or the bare Dev Container with no name', async () => {
    const reads: string[] = [];
    for (const [name, content] of [
      ['c50-dot', {name: 'Dotted'}],
      ['c50-bare', {}],
    ] as const) {
      const window = await open(
        configFolder(name, {'.devcontainer.json': content}),
      );
      await reopenInContainer(window);
      reads.push(await settledIndicator(window));
    }
    deepStrictEqual(reads, ['Dev Container: Dotted', 'Dev Container']);
  });

  it('F-0301 AC-3, F-0401 AC-7 (c3): several configurations show the picker with the root first, each with its path and an Open File button and the first row focused, again after a choice and a return to the local folder', async () => {
    const folder = configFolder('c50-several', {
      '.devcontainer.json': {name: 'Root'},
      '.devcontainer/a/devcontainer.json': {name: 'A'},
      '.devcontainer/b/devcontainer.json': {name: 'B'},
    });
    const expected = {
      placeholder: 'Select a devcontainer.json file.',
      rows: [
        {
          label: 'Root',
          description: '.devcontainer.json',
          buttons: ['Open File'],
          focused: true,
        },
        {
          label: 'A',
          description: '.devcontainer/a/devcontainer.json',
          buttons: ['Open File'],
          focused: false,
        },
        {
          label: 'B',
          description: '.devcontainer/b/devcontainer.json',
          buttons: ['Open File'],
          focused: false,
        },
      ],
    };
    const first = await open(folder);
    const shown = await pickOf(first);
    await chooseQuickPickItem(first, 'B');
    await shown.running.catch(() => undefined);
    await connectedAs(first);
    await closeWindow(first);
    opened.length = 0;
    const second = await open(folder);
    const again = await pickOf(second);
    await pressEscape(second);
    await again.running.catch(() => undefined);
    deepStrictEqual(
      [
        {placeholder: shown.placeholder, rows: shown.rows},
        {placeholder: again.placeholder, rows: again.rows},
      ],
      [expected, expected],
    );
  });

  it('F-0301 AC-8 (c4): Escape closes the picker and the window stays local with no message', async () => {
    const window = await open(
      configFolder('c50-escape', {
        '.devcontainer/a/devcontainer.json': {name: 'A'},
        '.devcontainer/b/devcontainer.json': {name: 'B'},
      }),
    );
    const shown = await pickOf(window);
    await pressEscape(window);
    await shown.running.catch(() => undefined);
    await waitFor(
      `the picker of window ${window} to close`,
      async () => (await quickPickOf(window)) === undefined,
      10_000,
    );
    deepStrictEqual(
      [
        (await windowState(window)).remoteName,
        (await notificationCentre(window)).filter(
          text => !text.startsWith(NOTICE_START),
        ),
        await dialogOf(window),
      ],
      [null, [], undefined],
    );
  });

  it('F-0301 AC-25 (c5): a name with a variable is shown raw in the picker, and the connected window shows it substituted', async () => {
    const window = await open(
      configFolder('c50-variable', {
        '.devcontainer/a/devcontainer.json': {name: 'Plain'},
        '.devcontainer/b/devcontainer.json': {
          name: 'Run ${localEnv:HARNESS_RUN_ID}',
        },
      }),
    );
    const shown = await pickOf(window);
    await chooseQuickPickItem(window, 'Run ${localEnv:HARNESS_RUN_ID}');
    await shown.running.catch(() => undefined);
    const connected = await connectedAs(window);
    deepStrictEqual(
      [shown.rows.map(entry => entry.label), connected.title],
      [
        ['Plain', 'Run ${localEnv:HARNESS_RUN_ID}'],
        `[c50-variable [Dev Container: Run ${variable('HARNESS_RUN_ID')}]]`,
      ],
    );
  });

  it('F-0301 AC-47 (c6): configurations with no name are labelled Project Root, Main and the folder’s name', async () => {
    const window = await open(
      configFolder('c50-unnamed', {
        '.devcontainer.json': {},
        '.devcontainer/devcontainer.json': {},
        '.devcontainer/a/devcontainer.json': {},
      }),
    );
    const shown = await pickOf(window);
    await pressEscape(window);
    await shown.running.catch(() => undefined);
    deepStrictEqual(
      shown.rows.map(entry => entry.label),
      ['Project Root', 'Main', 'a'],
    );
  });

  it('F-0401 AC-7 (c7): Open File on a row of the picker opens that configuration in a preview editor and starts no container; Escape then leaves the window unchanged', async () => {
    const folder = configFolder('c50-open-file', {
      '.devcontainer.json': {name: 'Root'},
      '.devcontainer/a/devcontainer.json': {name: 'A'},
    });
    const window = await open(folder);
    const shown = await pickOf(window);
    await pressQuickPickRowButton(window, 'A', 'Open File');
    async function opened(): Promise<string[]> {
      return (await editorTabs(window))
        .filter(entry => entry.preview && entry.label !== 'Welcome')
        .map(entry => entry.label);
    }
    await waitFor(
      `window ${window} to show the configuration`,
      async () => (await opened()).length > 0,
      30_000,
    );
    const afterOpen = {
      tabs: await opened(),
      containers: (await devContainersOf(folder)).length,
    };
    await pressEscape(window);
    await shown.running.catch(() => undefined);
    await waitFor(
      `the picker of window ${window} to close`,
      async () => (await quickPickOf(window)) === undefined,
      10_000,
    );
    deepStrictEqual(
      [
        afterOpen,
        (await windowState(window)).remoteName,
        await windowTitle(window),
        (await notificationCentre(window)).filter(
          text => !text.startsWith(NOTICE_START),
        ),
        await dialogOf(window),
        (await devContainersOf(folder)).length,
      ],
      [
        {tabs: ['devcontainer'], containers: 0},
        null,
        '[c50-open-file]',
        [],
        undefined,
        0,
      ],
    );
  });
});
