import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  startInWindow,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {closePick, pickShown} from '../windows/explorer-home.ts';
import {
  chooseQuickPickItem,
  extensionPackTabOf,
  extensionPageOf,
  extensionsViewSections,
  languageModeOf,
  lineTokensOf,
  suggestionsOf,
  typeInFocus,
} from '../windows/renderer.ts';
import {packHome, writeClientSshConfig} from './pack-home.ts';

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

  /** The path-valued row of the picker of Open SSH Configuration File that ends in `suffix`. */
  async function pickedFile(suffix: string): Promise<string> {
    await startInWindow(window, 'opensshremotes.openConfigFile');
    const picked = await pickShown(window);
    const found = picked.rows.find(entry => entry.endsWith(suffix));
    if (found === undefined) {
      throw new Error(
        `the picker lists no ${suffix}: ${JSON.stringify(picked)}`,
      );
    }
    return found;
  }

  /** Closes the active editor, dropping what was typed into it. */
  async function dropActiveEditor(): Promise<void> {
    await inWindow(window, 'workbench.action.revertAndCloseActiveEditor');
  }

  it('F-2007 AC-2 (c2499-pack-tab): the extension’s page has an Extension Pack tab listing the edit companion first and Remote Explorer second, and the manifest declares those two ids in that order and no extensionDependencies', async () => {
    const page = await extensionPageOf(window, 'Remote - SSH');
    const packTab = await extensionPackTabOf(window);
    const extensions = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensions-ssh-pack',
    );
    const folder = readdirSync(extensions).find(entry =>
      /^remote-oss\.remote-ssh-\d/.test(entry),
    );
    const installed = JSON.parse(
      readFileSync(
        path.join(extensions, folder ?? 'missing', 'package.json'),
        'utf8',
      ),
    ) as {extensionPack?: string[]; extensionDependencies?: string[]};
    deepStrictEqual(
      [
        page.tabs.map(label => label.toUpperCase()),
        packTab,
        installed.extensionPack,
        installed.extensionDependencies,
      ],
      [
        ['DETAILS', 'FEATURES', 'EXTENSION PACK'],
        ['Remote - SSH: Editing Configuration Files', 'Remote Explorer'],
        ['remote-oss.remote-ssh-edit', 'remote-oss.remote-explorer'],
        undefined,
      ],
    );
  });

  it('F-2007 AC-3 (c2499-config-language): the user’s config file opens in the edit companion’s mode with colouring and keyword completion', async () => {
    const file = await pickedFile('.ssh/config');
    await chooseQuickPickItem(window, file);
    await waitFor(
      'the config file to open with a language mode',
      async () => (await languageModeOf(window)) !== '',
      30_000,
    );
    const mode = await languageModeOf(window);
    const tokens = await lineTokensOf(window, 'Host');
    await inWindow(window, 'cursorBottom');
    await typeInFocus(window, '\nForw');
    await inWindow(window, 'editor.action.triggerSuggest');
    await waitFor(
      'the keyword suggestions',
      async () => (await suggestionsOf(window)).length > 0,
      10_000,
    );
    const suggestions = await suggestionsOf(window);
    await dropActiveEditor();
    deepStrictEqual(
      [
        mode,
        new Set(tokens.map(token => token.tokenClass)).size === tokens.length,
        suggestions.includes('ForwardAgent'),
      ],
      ['SSH Config', true, true],
    );
  });

  it('F-2007 AC-12 (c2499-custom-file): a config file outside the companion’s patterns opens in the mode the editor assigns, Plain Text', async () => {
    const saved = readUserSettings();
    const custom = path.join(packHome(), 'f2007-custom-hosts');
    writeFileSync(custom, 'Host custom\n  HostName custom.invalid\n');
    try {
      await userSettings({'remote.SSH.configFile': custom});
      await startInWindow(window, 'opensshremotes.openConfigFile');
      const picked = await pickShown(window);
      await chooseQuickPickItem(window, picked.rows[0] ?? custom);
      await waitFor(
        'the custom file to open with a language mode',
        async () => (await languageModeOf(window)) !== '',
        30_000,
      );
      const mode = await languageModeOf(window);
      await dropActiveEditor();
      deepStrictEqual([picked.rows[0], mode], [custom, 'Plain Text']);
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2007 AC-14 (c2499-menu-part): the remote indicator menu of a local window lists Connect to Host... and Connect Current Window to Host...', async () => {
    await startInWindow(window, 'workbench.action.remote.showMenu');
    const menu = await pickShown(window);
    await closePick(window);
    deepStrictEqual(
      [menu.placeholder, menu.rows],
      [
        'Select an option to open a Remote Window',
        ['Connect to Host...', 'Connect Current Window to Host...'],
      ],
    );
  });
});
