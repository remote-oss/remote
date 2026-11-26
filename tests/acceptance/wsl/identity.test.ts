import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  editorProduct,
  inWindow,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {
  editorTabs,
  extensionPageOf,
  extensionsViewSections,
  windowTitle,
} from '../windows/renderer.ts';
import {runFolder} from './wsl-support.ts';

/** The name the extension shows everywhere, from the English text of its manifest. */
const NAME = 'WSL';

/** The setting that gives a window its title, the launch's template for it, and the editor's own with the active editor in. */
const TITLE_SETTING = 'window.title';
const LAUNCH_TITLE = '[${rootName}]';
const WITH_EDITOR_TITLE =
  '[${rootName}] ${activeEditorShort}${separator}${rootName}${separator}${appName}';

describe('the identity of the WSL extension (F-6005, card #3141)', function () {
  this.timeout(180_000);

  it('F-6005 AC-12, AC-14 (w6005-name): the installed row, the extension editor, its tab and the window title say WSL, and the side column has the one category Other', async () => {
    const folder = runFolder('w6005-name');
    const window = await openFolderWindow(folder);
    try {
      await inWindow(window, 'workbench.view.extensions');
      await waitFor(
        'the Extensions view to list the extension',
        async () =>
          (await extensionsViewSections(window)).some(section =>
            section.entries.includes(NAME),
          ),
        30_000,
      );
      const page = await extensionPageOf(window, NAME);
      const tabs = (await editorTabs(window)).map(each => each.label);
      await setUserSetting(TITLE_SETTING, WITH_EDITOR_TITLE);
      const folderName = folder.split(/[\\/]/).at(-1) ?? '';
      await waitFor(
        'the window title to have the active editor in it',
        async () => (await windowTitle(window)).includes(`${NAME} - `),
        15_000,
      );
      const title = (await windowTitle(window)).replace(`[${folderName}] `, '');
      deepStrictEqual(
        {name: page.title, tabs, categories: page.categories, title},
        {
          name: NAME,
          tabs: [`Extension: ${NAME}`],
          categories: ['Other'],
          title: `Extension: ${NAME} - ${folderName} - ${editorProduct().nameLong}`,
        },
      );
    } finally {
      await setUserSetting(TITLE_SETTING, LAUNCH_TITLE);
      await closeWindow(window);
    }
  });
});
