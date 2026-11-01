import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {
  activeEditorOf,
  closeWindow,
  devContainerFolder,
  devContainersOf,
  OLD_GLIBC_IMAGE,
  reloadWindow,
  reopenInContainer,
  connectedToContainer,
  reopenStarted,
  runLabelArguments,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogDetailLines,
  dialogOf,
  editorGroups,
  pressEscape,
  primaryButtonOf,
  type ShownDialog,
  statusItem,
  windowTitle,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  activations,
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The strings of the editor's table the dialogs show, as `failure-strings.ts` has them. */
const S018 =
  'A mount config is invalid. Make sure it has the right format and a source folder that exists on the machine where the Docker daemon is running.';
const S019 =
  'A port the container is setup to bind to is already in use. See the Dev Containers terminal for details.';
const S034 = 'An error occurred setting up the container.';
const S272 = 'Pick an action to help resolve the problem.';
const S339 =
  "The 'docker' command was not found. Make sure Docker is installed.";
const S346 =
  'The container does not meet all the requirements of the VS Code Server.';

/** The dialog of a failed connect takes the image pull, the CLI's run and the server's install. */
const DIALOG_MILLISECONDS = 180_000;

/** How long a dialog left alone is watched (F-0410 AC-2). */
const IDLE_MILLISECONDS = 35_000;

/** How long Edit Locally has to show the configuration file in the reopened window (F-0410 AC-4). */
const EDIT_MILLISECONDS = 10_000;

/** What a failure dialog says: its message and its detail. */
function sayingOf(
  dialog: ShownDialog,
): Pick<ShownDialog, 'message' | 'details'> {
  return {message: dialog.message, details: dialog.details};
}

describe('Dev Containers failure dialog and quick pick (card containers-11)', function () {
  this.timeout(600_000);

  const opened: string[] = [];
  const folders: string[] = [];

  /** A folder of the run for a dev container configuration, closed and cleaned up after the row. */
  function folderOf(
    name: string,
    configuration: Readonly<Record<string, unknown>>,
  ): string {
    const folder = devContainerFolder(name, {name, ...configuration});
    folders.push(folder);
    return folder;
  }

  async function open(folder: string): Promise<string> {
    const name = await openFolderWindow(folder);
    opened.push(name);
    return name;
  }

  async function failed(folder: string): Promise<{
    name: string;
    dialog: ShownDialog;
  }> {
    const name = await open(folder);
    await reopenStarted(name);
    return {name, dialog: await waitForDialog(name, DIALOG_MILLISECONDS)};
  }

  afterEach(async () => {
    for (const name of opened.splice(0)) {
      await closeWindow(name);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });

  it('F-0410 AC-13 (r1): a nonexistent image shows no message and the generic detail in the reloaded window, and makes no container', async () => {
    const folder = folderOf('recover-missing-image', {
      image: 'remote-oss-acceptance-missing:none',
    });
    const {name, dialog} = await failed(folder);
    deepStrictEqual(
      {
        saying: sayingOf(dialog),
        indicator: (await statusItem(name, 'status.host')).text,
        containers: await devContainersOf(folder),
      },
      {
        saying: {message: '', details: S034},
        indicator: 'Opening Remote...',
        containers: [],
      },
    );
  });

  it('F-0410 AC-1 (r1b): a setup that fails for a reason of its own shows no message and the generic detail, and the window stays on Opening Remote...', async () => {
    const {name, dialog} = await failed(
      folderOf('recover-generic', {
        runArgs: [...runLabelArguments(), '--no-such-flag'],
      }),
    );
    deepStrictEqual(
      {
        saying: sayingOf(dialog),
        indicator: (await statusItem(name, 'status.host')).text,
      },
      {
        saying: {message: '', details: S034},
        indicator: 'Opening Remote...',
      },
    );
  });

  it('F-0410 AC-1 (buttons): the dialog has exactly Edit devcontainer.json Locally, More Actions... and Retry in the editor’s order, with no Cancel of its own and Retry primary, the title and the indicator stay as they were while it is open, and Escape is More Actions...', async () => {
    const {name, dialog} = await failed(
      folderOf('recover-buttons', {
        runArgs: [...runLabelArguments(), '--no-such-flag'],
      }),
    );
    const primary = await primaryButtonOf(name);
    const whileOpen = {
      title: await windowTitle(name),
      indicator: (await statusItem(name, 'status.host')).text,
    };
    await pressEscape(name);
    const pick = await waitForQuickPick(name, 30_000);
    deepStrictEqual(
      {buttons: dialog.buttons, primary, whileOpen, pick: pick.placeholder},
      {
        buttons: ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
        primary: 'Retry',
        whileOpen: {title: '[recover-buttons]', indicator: 'Opening Remote...'},
        pick: S272,
      },
    );
  });

  it('F-0410 AC-5 (title): a window whose connect failed is titled [Dev Container], and the indicator reads Disconnected from Dev Container after More Actions...', async () => {
    const {name} = await failed(
      folderOf('recover-title', {
        runArgs: [...runLabelArguments(), '--no-such-flag'],
      }),
    );
    await answerDialog(name, 'More Actions...');
    await waitForQuickPick(name, 30_000);
    await pressEscape(name);
    deepStrictEqual(
      {
        title: await windowTitle(name),
        indicator: (await statusItem(name, 'status.host')).text,
      },
      {
        title: '[recover-title [Dev Container]]',
        indicator: 'Disconnected from Dev Container',
      },
    );
  });

  it('F-0410 AC-11 (r2): a bind mount whose source is missing shows the mount detail, and leaves no container', async () => {
    const folder = folderOf('recover-mount', {
      mounts: [
        `source=${path.join(variable('HARNESS_RUN_FOLDER'), 'missing')},target=/x,type=bind`,
      ],
    });
    const {dialog} = await failed(folder);
    deepStrictEqual(
      {saying: sayingOf(dialog), containers: await devContainersOf(folder)},
      {saying: {message: '', details: S018}, containers: []},
    );
  });

  /** Runs a container of the run that publishes a host port, and gives its id and that port. */
  async function portHolder(): Promise<{helperId: string; port: number}> {
    const {stdout: helper} = await execFileAsync('docker', [
      'run',
      '--detach',
      ...runLabelArguments(),
      '--publish',
      '8000',
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'sleep',
      '600',
    ]);
    const helperId = helper.trim();
    const {stdout: port} = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',
      helperId,
    ]);
    return {helperId, port: Number.parseInt(port.trim(), 10)};
  }

  it('F-0410 AC-12, F-0409 AC-31 (r3): a port that is already published shows the port detail, and leaves the created container', async () => {
    const {helperId, port} = await portHolder();
    try {
      const folder = folderOf('recover-port', {appPort: [port]});
      const {dialog} = await failed(folder);
      const containers = await devContainersOf(folder);
      const {stdout: states} = await execFileAsync('docker', [
        'inspect',
        '--format',
        '{{.State.Status}}',
        ...containers,
      ]);
      deepStrictEqual(
        {
          saying: sayingOf(dialog),
          containers: containers.length,
          states: states.trim(),
        },
        {
          saying: {message: '', details: S019},
          containers: 1,
          states: 'created',
        },
      );
    } finally {
      await execFileAsync('docker', ['rm', '--force', helperId]);
    }
  });

  it('F-0410 AC-12b, F-0409 AC-31 (p12b): after a port conflict leaves a created container, Retry starts that same container', async () => {
    const {helperId, port} = await portHolder();
    try {
      const folder = folderOf('recover-port-retry', {appPort: [port]});
      const {name} = await failed(folder);
      const created = await devContainersOf(folder);
      await execFileAsync('docker', ['rm', '--force', helperId]);
      const before = activations(name);
      await answerDialog(name, 'Retry');
      await waitFor(
        `window ${name} to activate again`,
        () => activations(name) > before,
        60_000,
      );
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      const {stdout: states} = await execFileAsync('docker', [
        'inspect',
        '--format',
        '{{.State.Status}}',
        ...created,
      ]);
      deepStrictEqual(
        {
          containers: await devContainersOf(folder),
          states: states.trim(),
          created: created.length,
        },
        {containers: created, states: 'running', created: 1},
      );
    } finally {
      await execFileAsync('docker', ['rm', '--force', helperId]).catch(
        () => undefined,
      );
    }
  });

  it('F-0410 AC-5, AC-6, F-0202 AC-9 (r4): More Actions... opens the quick pick with its four items', async () => {
    const {name} = await failed(
      folderOf('recover-pick', {
        runArgs: [...runLabelArguments(), '--no-such-flag'],
      }),
    );
    await answerDialog(name, 'More Actions...');
    const pick = await waitForQuickPick(name, 30_000);
    deepStrictEqual(pick, {
      placeholder: S272,
      items: [
        'Reload Window',
        'Edit devcontainer.json Locally',
        'Open Recent...',
        'Open Documentation',
      ],
    });
  });

  it('F-0410 AC-4, F-0201 AC-10 (r5): Edit devcontainer.json Locally reopens the folder in the same window with the configuration open', async () => {
    const folder = folderOf('recover-edit', {
      runArgs: [...runLabelArguments(), '--no-such-flag'],
    });
    const {name} = await failed(folder);
    const before = activations(name);
    await answerDialog(name, 'Edit devcontainer.json Locally');
    await waitFor(
      `window ${name} to activate in its local folder`,
      () => activations(name) > before,
      EDIT_MILLISECONDS,
    );
    const configuration = path.join(
      folder,
      '.devcontainer',
      'devcontainer.json',
    );
    await waitFor(
      `window ${name}'s active editor to be ${configuration}`,
      async () => (await activeEditorOf(name)) === configuration,
      EDIT_MILLISECONDS,
    );
    await waitFor(
      `window ${name} to show the failed attempt's log beside the configuration`,
      async () => (await editorGroups(name)).length === 2,
      EDIT_MILLISECONDS,
    );
    const state = await windowState(name);
    const [first = [], second = []] = await editorGroups(name);
    deepStrictEqual(
      {
        remoteName: state.remoteName,
        folders: state.folders,
        active: await activeEditorOf(name),
        first: first.map(entry => [entry.label, entry.preview]),
        second: second.map(entry => [
          entry.label.startsWith('dev-containers-attempt-'),
          entry.preview,
        ]),
      },
      {
        remoteName: null,
        folders: [pathToFileURL(folder).href],
        active: configuration,
        first: [['devcontainer', true]],
        second: [[true, true]],
      },
    );
  });

  it('F-0410 AC-3 (r6): Retry shows the same dialog again after the reload', async () => {
    const {name, dialog} = await failed(
      folderOf('recover-retry', {
        runArgs: [...runLabelArguments(), '--no-such-flag'],
      }),
    );
    const before = activations(name);
    await answerDialog(name, 'Retry');
    await waitFor(
      `window ${name} to activate again`,
      () => activations(name) > before,
      60_000,
    );
    deepStrictEqual(await waitForDialog(name, DIALOG_MILLISECONDS), dialog);
  });

  it('containers-11 (r7) F-0201 7.E14: a window that was connected and then has no docker command shows the pre-flight dialog with its detail', async () => {
    const bogus = path.join(variable('HARNESS_RUN_FOLDER'), 'no-such-docker');
    const folder = folderOf('recover-docker', {});
    const name = await open(folder);
    await reopenInContainer(name);
    await setUserSetting('dev.containers.dockerPath', bogus);
    try {
      await reloadWindow(name);
      deepStrictEqual(
        sayingOf(await waitForDialog(name, DIALOG_MILLISECONDS)),
        {message: '', details: S339},
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0410 AC-2 (r8): the dialog left alone stays as it is, and the window stays on Opening Remote...', async () => {
    const {name, dialog} = await failed(
      folderOf('recover-idle', {
        runArgs: [...runLabelArguments(), '--no-such-flag'],
      }),
    );
    await new Promise(resolve => setTimeout(resolve, IDLE_MILLISECONDS));
    deepStrictEqual(
      {
        dialog: await dialogOf(name),
        indicator: (await statusItem(name, 'status.host')).text,
      },
      {dialog, indicator: 'Opening Remote...'},
    );
  });

  it("F-0503 AC-14 (r9): a container whose glibc is too old shows the requirements dialog with the check's own lines", async () => {
    const {name, dialog} = await failed(
      folderOf('recover-glibc', {image: OLD_GLIBC_IMAGE}),
    );
    const lines = await dialogDetailLines(name);
    deepStrictEqual(
      {
        message: dialog.message,
        primary: await primaryButtonOf(name),
        lines: lines.length,
        glibc: lines[0]?.startsWith('Warning: Missing GLIBC >= 2.28!'),
        dependencies: lines[1]?.startsWith(
          'Error: Missing required dependencies.',
        ),
      },
      {
        message: S346,
        primary: 'Learn More',
        lines: 2,
        glibc: true,
        dependencies: true,
      },
    );
    await answerDialog(name, 'More Actions...');
    await waitForQuickPick(name, 30_000);
  });
});
