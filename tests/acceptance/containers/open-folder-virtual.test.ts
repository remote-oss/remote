import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  openMemoryWindow,
  removeContainers,
} from '../windows/folder-windows.ts';
import {
  answerDialog,
  answerFolderDialog,
  detailedQuickPickRows,
  dialogOf,
  folderDialogFacts,
  folderDialogOpen,
  notifications,
  pressEscape,
  quickPickFacts,
  quickPickRows,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {dockerObjects} from './resolve-support.ts';

/** The folder pick of Open Folder in Container, started in window `name` and not awaited: the dialog it opens answers it. */
async function folderPickIn(name: string): Promise<void> {
  const running = inWindow(name, 'remote-containers.openFolder');
  running.catch(() => undefined);
  await waitFor('the folder dialog', () => folderDialogOpen(name), 60_000);
  await new Promise(resolve => setTimeout(resolve, 1000));
}

describe('F-0403 Open Folder in Container in virtual workspaces (card coverage-71)', function () {
  this.timeout(600_000);

  it('F-0403 AC-4, AC-18 (c71-virtual-window): in a window of the virtual folder memfs:/ the indicator menu has no Open Folder in Container, the command opens the ordinary folder dialog at the local home directory, and a folder with no configuration gives the where-to pick with its two rows and no Back button', async () => {
    const name = await openMemoryWindow();
    const target = path.join(variable('HARNESS_RUN_FOLDER'), 'c71-bare');
    mkdirSync(target, {recursive: true});
    try {
      void inWindow(name, 'workbench.action.remote.showMenu').catch(
        () => undefined,
      );
      await waitFor(
        'the indicator menu',
        async () => (await quickPickRows(name).catch(() => [])).length > 0,
        30_000,
      );
      const menu = (await quickPickRows(name)).map(entry => entry.label);
      await pressEscape(name);
      await folderPickIn(name);
      const start = (await folderDialogFacts(name)).value;
      await answerFolderDialog(name, target);
      await waitFor(
        'the where-to pick',
        async () =>
          (await quickPickFacts(name))?.title ===
          'Add Dev Container Configuration Files',
        60_000,
      );
      const facts = await quickPickFacts(name);
      const rows = (await detailedQuickPickRows(name)).map(entry => [
        entry.label,
        entry.detail,
        entry.focused,
      ]);
      await pressEscape(name);
      deepStrictEqual(
        {
          menu: menu.includes('Open Folder in Container...'),
          start,
          facts,
          rows,
        },
        {
          menu: false,
          start: `${os.homedir()}/`,
          facts: {
            title: 'Add Dev Container Configuration Files',
            placeholder:
              'Where would you like to create your container configuration?',
            titleButtons: [],
            multiSelect: false,
          },
          rows: [
            [
              'Add configuration to workspace',
              'This allows you to share the configuration with others via source control',
              true,
            ],
            [
              'Add configuration to user data folder',
              'This avoids having outgoing changes in your workspace folder',
              false,
            ],
          ],
        },
      );
    } finally {
      await closeWindow(name);
    }
  });

  it('F-0403 AC-28 (c71-untitled): in an untitled workspace core asks whether to save the workspace configuration before the window changes; Cancel leaves the window and creates nothing, and Don’t Save reloads the same window into one container', async () => {
    const base = path.join(variable('HARNESS_RUN_FOLDER'), 'c71-untitled-base');
    mkdirSync(base, {recursive: true});
    const target = devContainerFolder('c71-untitled-target', {
      name: 'Untitled Target',
    });
    const name = await openFolderWindow(base);
    try {
      await inWindow(name, 'acceptance.agent.updateWorkspaceFolders', 1, 0, [
        'memfs:/',
      ]);
      await waitFor(
        'the untitled workspace',
        async () =>
          (await windowTitle(name).catch(() => '')) ===
          '[Untitled (Workspace)]',
        60_000,
      );
      const before = await dockerObjects();
      await folderPickIn(name);
      await answerFolderDialog(name, target);
      const asked = await waitForDialog(name, 120_000);
      const question = [asked.message, asked.details, [...asked.buttons]];
      await answerDialog(name, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 5000));
      const afterCancel = {
        title: await windowTitle(name),
        dialog: await dialogOf(name),
        notifications: await notifications(name),
        unchanged: (await dockerObjects()) === before,
      };
      await folderPickIn(name);
      await answerFolderDialog(name, target);
      await waitForDialog(name, 120_000);
      await answerDialog(name, "Don't Save");
      await connectedToContainer('c71-untitled-target');
      deepStrictEqual(
        {
          question,
          afterCancel,
          containers: (await devContainersOf(target)).length,
        },
        {
          question: [
            'Do you want to save your workspace configuration as a file?',
            'Save your workspace if you plan to open it again.',
            ["Don't Save", 'Cancel', 'Save'],
          ],
          afterCancel: {
            title: '[Untitled (Workspace)]',
            dialog: undefined,
            notifications: [],
            unchanged: true,
          },
          containers: 1,
        },
      );
    } finally {
      await closeWindow('c71-untitled-target').catch(() => undefined);
      await closeWindow(name).catch(() => undefined);
      await removeContainers(target);
    }
  });
});
