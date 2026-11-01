import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  cancelFolderDialog,
  folderDialogFacts,
  folderDialogOpen,
  pressQuickPickTitleButton,
} from '../windows/renderer.ts';

/** A folder of the run with the sub-folders `names`, a hidden one and a plain file, and no dev container configuration. */
function treeFolder(label: string, names: readonly string[]): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  for (const name of [...names, '.hidden']) {
    mkdirSync(path.join(folder, name), {recursive: true});
  }
  writeFileSync(path.join(folder, 'plain.txt'), 'x');
  return folder;
}

/** Opens a window on `folder`, starts Open Folder in Container there, waits for the folder dialog and gives the window. */
async function dialogOn(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  const running = inWindow(name, 'remote-containers.openFolder');
  running.catch(() => undefined);
  await waitFor('the folder dialog', () => folderDialogOpen(name), 60_000);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return name;
}

describe('F-0403 the folder pick of Open Folder in Container (card coverage-71)', function () {
  this.timeout(600_000);

  it('F-0403 AC-2 (c71-dialog): the folder pick is an input with the placeholder Folder path and the current folder’s path, an Open button, a Hide dot files title button that toggles to Show dot files, the sub-folders only with a leading .., and the focus on the input with no row focused', async () => {
    const folder = treeFolder('c71-dialog', ['one', 'two']);
    const name = await dialogOn(folder);
    try {
      const facts = await folderDialogFacts(name);
      await pressQuickPickTitleButton(name, 'Hide dot files');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const hidden = await folderDialogFacts(name);
      deepStrictEqual(
        {facts, hidden: [hidden.titleButtons, hidden.rows]},
        {
          hidden: [['Show dot files'], ['..', 'one', 'two']],
          facts: {
            placeholder: 'Folder path',
            value: `${folder}/`,
            buttons: ['Open'],
            titleButtons: ['Hide dot files'],
            rows: ['..', '.hidden', 'one', 'two'],
            inputFocused: true,
            focusedRow: null,
          },
        },
      );
    } finally {
      await cancelFolderDialog(name).catch(() => undefined);
      await closeWindow(name).catch(() => undefined);
    }
  });
});
