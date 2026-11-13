import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  dialogOf,
  extensionContextMenu,
  extensionMenuAction,
  extensionsViewSections,
} from '../windows/renderer.ts';

/** The extension and the display names of its two companions in the Extensions view. */
const EXTENSION = 'Remote - SSH';
const COMPANIONS = [
  'Remote - SSH: Editing Configuration Files',
  'Remote Explorer',
];

describe('the pack disabled and enabled together (card #2499)', function () {
  this.timeout(300_000);
  let window = '';

  before(async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'pack-enablement');
    mkdirSync(folder, {recursive: true});
    window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the three',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          [EXTENSION, ...COMPANIONS].every(each =>
            section.entries.includes(each),
          ),
        ),
      30_000,
    );
  });

  after(async () => {
    await closeWindow(window);
  });

  /** The Enable and Disable actions among the labels of each companion's context menu. */
  async function companionMenus(): Promise<string[][]> {
    const menus: string[][] = [];
    for (const companion of COMPANIONS) {
      menus.push(
        (await extensionContextMenu(window, companion)).filter(
          label => label === 'Enable' || label === 'Disable',
        ),
      );
    }
    return menus;
  }

  it('F-2007 AC-9 (c2499-pack-enablement): disabling the extension disables both companions and enabling it enables them again', async () => {
    const before = await companionMenus();
    await extensionMenuAction(window, EXTENSION, 'Disable');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const disabled = await companionMenus();
    const dialogDisabling = await dialogOf(window);
    await extensionMenuAction(window, EXTENSION, 'Enable');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const enabled = await companionMenus();
    deepStrictEqual(
      [before, disabled, enabled, dialogDisabling],
      [
        [['Disable'], ['Disable']],
        [['Enable'], ['Enable']],
        [['Disable'], ['Disable']],
        undefined,
      ],
    );
  });
});
