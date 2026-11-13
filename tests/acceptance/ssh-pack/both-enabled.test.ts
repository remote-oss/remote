import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  inWindow,
  startInWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {pickShown} from '../windows/explorer-home.ts';
import {
  chooseQuickPickItem,
  editorTabs,
  extensionPageOf,
  extensionsViewSections,
  languageModeOf,
  lineTokensOf,
  notifications,
  suggestionsOf,
  typeInFocus,
} from '../windows/renderer.ts';
import {writeClientSshConfig} from './pack-home.ts';

describe('the extension and both companions enabled (card #2499)', function () {
  this.timeout(300_000);
  let window = '';

  before(async () => {
    writeClientSshConfig();
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'pack-both');
    mkdirSync(folder, {recursive: true});
    window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list Remote - SSH',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes('Remote - SSH'),
        ),
      30_000,
    );
  });

  after(async () => {
    await closeWindow(window);
  });

  it('F-2007 (c2499-measure-both): what the window shows of the extension and its config file', async () => {
    const found: Record<string, unknown> = {};
    try {
      found.page = await extensionPageOf(window, 'Remote - SSH');
      await startInWindow(window, 'opensshremotes.openConfigFile');
      const picked = await pickShown(window);
      found.picker = picked;
      const file = picked.rows.find(entry => entry.includes('.ssh/config'));
      if (file !== undefined) {
        await chooseQuickPickItem(window, file.split(' | ')[0] ?? file);
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
      found.mode = await languageModeOf(window);
      found.tokens = await lineTokensOf(window, 'Host');
      found.tabs = (await editorTabs(window)).map(each => each.label);
      await inWindow(window, 'cursorBottom');
      await typeInFocus(window, '\nForw');
      await inWindow(window, 'editor.action.triggerSuggest');
      await new Promise(resolve => setTimeout(resolve, 1500));
      found.suggestions = await suggestionsOf(window);
      found.notifications = await notifications(window);
    } catch (caught) {
      found.failure = String(caught);
    }
    throw new Error(`MEASURED ${JSON.stringify(found)}`);
  });
});
