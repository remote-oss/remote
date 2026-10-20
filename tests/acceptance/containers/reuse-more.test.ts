import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  activeEditorOf,
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  reopenStarted,
  runLabelArguments,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  statusItem,
  type ShownDialog,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  activations,
  openFolderWindow,
  openWorkspaceWindow,
  removeContainers,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The string of the editor's table that the failed-setup dialog shows, and F-0410's three buttons, sorted. */
const S034 = 'An error occurred setting up the container.';
const RECOVERY_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** How long a connect that ends in a dialog takes. */
const DIALOG_MILLISECONDS = 180_000;

/** Core's dialog for a window whose container went away. */
const CANNOT_RECONNECT = {
  message: '',
  details: 'Cannot reconnect. Please reload the window.',
  buttons: ['Cancel', 'Reload Window'],
};

/** The output of `docker` run with `parameters`, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** The one container of `folder`; it fails when the number is not one. */
async function containerOf(folder: string): Promise<string> {
  const containers = await devContainersOf(folder);
  const [containerId] = containers;
  if (containerId === undefined || containers.length !== 1) {
    throw new Error(
      `expected one container of ${folder}, found ${String(containers.length)}`,
    );
  }
  return containerId;
}

/** The dialog's message, details and sorted buttons. */
function sayingOf(dialog: ShownDialog): {
  message: string;
  details: string;
  buttons: string[];
} {
  return {
    message: dialog.message,
    details: dialog.details,
    buttons: [...dialog.buttons].sort(),
  };
}

/** Opens `folder` in a window, reopens it in its container, and gives the window's name. */
async function reopened(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  return name;
}

/** The start time of container `containerId`, from `docker inspect`. */
function startedAt(containerId: string): Promise<string> {
  return docker('inspect', '-f', '{{.State.StartedAt}}', containerId);
}

/** Waits for core's dialog in window `name` and gives what it says. */
async function reconnectDialog(name: string): Promise<ShownDialog> {
  return waitForDialog(name, 60_000);
}

describe('F-0409 the container of a folder: stops, removals, failures and workspaces (card containers-52)', function () {
  this.timeout(900_000);

  it('F-0409 AC-8, AC-9 (r8): a container stopped outside the editor shows core’s dialog, and Cancel leaves the window disconnected', async () => {
    const folder = devContainerFolder('c52-stopped', {name: 'Stopped One'});
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      await docker('stop', containerId);
      const dialog = await reconnectDialog(name);
      await answerDialog(name, 'Cancel');
      const title = await windowTitle(name);
      const indicator = (await statusItem(name, 'status.host')).text;
      deepStrictEqual(
        [sayingOf(dialog), title, indicator],
        [
          CANNOT_RECONNECT,
          '[c52-stopped [Dev Container: Stopped One]]',
          'Disconnected from Dev Container: Stopped One',
        ],
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-9 (r9): Reload Window on that dialog connects the window to the same container, restarted', async () => {
    const folder = devContainerFolder('c52-stopped-reload', {
      name: 'Stopped Two',
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      await docker('stop', containerId);
      await reconnectDialog(name);
      const activated = activations(name);
      await answerDialog(name, 'Reload Window');
      await waitFor(
        `window ${name} to activate again`,
        () => activations(name) > activated,
        60_000,
      );
      await connectedToContainer(name, DIALOG_MILLISECONDS);
      deepStrictEqual(
        [
          await devContainersOf(folder),
          await docker('inspect', '-f', '{{.State.Status}}', containerId),
          await dialogOf(name),
        ],
        [[containerId], 'running', undefined],
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-12 (r12): a container removed outside the editor shows the same dialog; Reload Window recreates it and Cancel leaves the window disconnected', async () => {
    const folders = [
      devContainerFolder('c52-removed-reload', {name: 'Removed One'}),
      devContainerFolder('c52-removed-cancel', {name: 'Removed Two'}),
    ];
    try {
      const seen: unknown[] = [];
      for (const [index, folder] of folders.entries()) {
        const name = await reopened(folder);
        const containerId = await containerOf(folder);
        await docker('rm', '-f', containerId);
        const dialog = await reconnectDialog(name);
        if (index === 0) {
          const activated = activations(name);
          await answerDialog(name, 'Reload Window');
          await waitFor(
            `window ${name} to activate again`,
            () => activations(name) > activated,
            60_000,
          );
          await connectedToContainer(name, DIALOG_MILLISECONDS);
          const [created = ''] = await devContainersOf(folder);
          seen.push([
            sayingOf(dialog),
            created !== '' && created !== containerId,
          ]);
        } else {
          await answerDialog(name, 'Cancel');
          seen.push([
            sayingOf(dialog),
            await windowTitle(name),
            (await statusItem(name, 'status.host')).text,
          ]);
        }
        await closeWindow(name);
      }
      deepStrictEqual(seen, [
        [CANNOT_RECONNECT, true],
        [
          CANNOT_RECONNECT,
          '[c52-removed-cancel [Dev Container: Removed Two]]',
          'Disconnected from Dev Container: Removed Two',
        ],
      ]);
    } finally {
      for (const folder of folders) {
        await removeContainers(folder);
      }
    }
  });
});
