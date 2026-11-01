import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  pressEscape,
  quickPickFacts,
} from '../windows/renderer.ts';
import {
  openMemoryWindow,
  openWorkspaceWindow,
  removeContainers,
  writeMemoryFile,
} from '../windows/folder-windows.ts';
import {containerOf} from './lifecycle-support.ts';

const execFileAsync = promisify(execFile);

/** The two commands of the rebuild with a reopen, as a user keybinding without a `when` clause invokes them. */
const REBUILD_COMMANDS = [
  'remote-containers.rebuildAndReopenInContainer',
  'remote-containers.rebuildNoCacheAndReopenInContainer',
];

/** How long the window is given to show a dialog or a quick pick after the command. */
const UI_MILLISECONDS = 6000;

/** The run's containers and the host's images, as one comparable text: what a build or a container would change. */
async function dockerObjects(): Promise<string> {
  const [containers, images] = await Promise.all([
    execFileAsync('docker', [
      'ps',
      '--all',
      '--quiet',
      '--filter',
      `label=remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
    ]),
    execFileAsync('docker', ['images', '--quiet', '--no-trunc']),
  ]);
  return `${containers.stdout}|${images.stdout.split('\n').sort().join(',')}`;
}

/**
 * Runs `command` in window `name`, gives it a moment, dismisses whatever dialog or quick pick shows (Cancel, else
 * Escape) and gives what it was.
 */
async function invokedAndDismissed(
  name: string,
  command: string,
): Promise<string[]> {
  const running = inWindow(name, command).catch(() => undefined);
  await new Promise(resolve => setTimeout(resolve, UI_MILLISECONDS));
  const shown: string[] = [];
  const dialog = await dialogOf(name);
  if (dialog !== undefined) {
    shown.push(`dialog: ${dialog.message} ${dialog.details}`);
    await answerDialog(
      name,
      dialog.buttons.includes('Cancel') ? 'Cancel' : (dialog.buttons[0] ?? ''),
    );
  }
  const pick = await quickPickFacts(name);
  if (pick !== undefined) {
    shown.push(`pick: ${pick.title}`);
    await pressEscape(name);
  }
  await running;
  return shown;
}

/** A folder of the run that holds only files named in `files` (relative paths with their text). */
function plainFolder(label: string, files: Record<string, string>): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  mkdirSync(folder, {recursive: true});
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, file)), {recursive: true});
    writeFileSync(path.join(folder, file), text);
  }
  return folder;
}

/** The text of a `.code-workspace` file whose only folder is the in-memory `memfs:/`. */
const MEMORY_WORKSPACE = JSON.stringify({folders: [{uri: 'memfs:/'}]});

describe('F-0405 the rebuild commands in virtual workspaces (card coverage-67)', function () {
  this.timeout(600_000);

  it('F-0405 AC-34 (c67-memfs-only): in a window whose only folder is memfs:/, untitled or saved, with and without memfs:/.devcontainer/devcontainer.json, both rebuild commands build nothing, create no container, write no file and leave the window as it is', async () => {
    const outcomes: unknown[] = [];
    const saved = plainFolder('c67-saved-bare', {
      'x.code-workspace': MEMORY_WORKSPACE,
    });
    for (const [kind, open] of [
      ['untitled', () => openMemoryWindow()],
      ['saved', () => openMemoryWindow(path.join(saved, 'x.code-workspace'))],
    ] as const) {
      for (const withConfiguration of [false, true]) {
        const name = await open();
        if (withConfiguration) {
          await writeMemoryFile(
            name,
            '/.devcontainer/devcontainer.json',
            JSON.stringify({image: variable('HARNESS_DEVCONTAINER_IMAGE')}),
          );
        }
        for (const command of REBUILD_COMMANDS) {
          const before = await dockerObjects();
          const shown = await invokedAndDismissed(name, command);
          const state = await windowState(name);
          outcomes.push({
            kind,
            withConfiguration,
            command,
            shown,
            unchanged: (await dockerObjects()) === before,
            folders: state.folders,
            remoteName: state.remoteName,
          });
        }
        await closeWindow(name);
      }
    }
    deepStrictEqual(
      {
        outcomes: outcomes.map(each => {
          const {folders, remoteName, unchanged} = each as {
            folders: string[];
            remoteName: string | null;
            unchanged: boolean;
          };
          return [folders, remoteName, unchanged];
        }),
        files: readdirSync(saved),
      },
      {
        outcomes: outcomes.map(() => [['memfs:/'], null, true]),
        files: ['x.code-workspace'],
      },
    );
  });

  it('F-0405 AC-35 (c67-memfs-shared-root): a saved workspace whose only folder is memfs:/ and whose own folder holds a configuration is not rebuilt: nothing is built or created before the user confirms, and dismissing leaves everything as it was', async () => {
    const folder = devContainerFolder('c67-shared-root', {name: 'Shared Root'});
    const file = path.join(folder, 'x.code-workspace');
    writeFileSync(file, MEMORY_WORKSPACE);
    const name = await openMemoryWindow(file);
    try {
      const results: unknown[] = [];
      for (const command of REBUILD_COMMANDS) {
        const before = await dockerObjects();
        const shown = await invokedAndDismissed(name, command);
        results.push([
          shown,
          (await dockerObjects()) === before,
          (await windowState(name)).remoteName,
        ]);
      }
      deepStrictEqual(
        results,
        REBUILD_COMMANDS.map(() => [[], true, null]),
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0405 AC-36 (c67-connected-workspace): a window connected from a saved workspace file, whose folders are local, keeps its container, its connection and its files when either rebuild command is invoked and dismissed', async () => {
    const folder = devContainerFolder('c67-workspace-window', {
      name: 'Workspace Window',
    });
    const file = path.join(folder, 'one.code-workspace');
    writeFileSync(file, JSON.stringify({folders: [{path: '.'}]}));
    try {
      const name = await openWorkspaceWindow(file);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      const files = readdirSync(folder).sort();
      const before = await dockerObjects();
      const results: unknown[] = [];
      for (const command of REBUILD_COMMANDS) {
        const shown = await invokedAndDismissed(name, command);
        results.push([
          shown,
          (await windowState(name)).remoteName,
          await containerOf(folder),
        ]);
      }
      const state = {
        results,
        unchanged: (await dockerObjects()) === before,
        files: readdirSync(folder).sort(),
        running: (
          await execFileAsync('docker', [
            'inspect',
            '-f',
            '{{.State.Status}}',
            containerId,
          ])
        ).stdout.trim(),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        results: REBUILD_COMMANDS.map(() => [[], 'dev-container', containerId]),
        unchanged: true,
        files,
        running: 'running',
      });
    } finally {
      await removeContainers(folder);
    }
  });
});
