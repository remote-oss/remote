import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  dialogOf,
  displayLanguageOf,
  extensionRowOf,
  extensionsViewSections,
  notifications,
} from '../windows/renderer.ts';

/** The pack's English strings, which a display language with no translation of them shows. */
const ENGLISH = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'packages',
      'remote-extensionpack',
      'package.nls.json',
    ),
    'utf8',
  ),
) as {displayName: string; description: string};

describe('the extension pack in a German editor with no language pack (card coverage-76)', function () {
  this.timeout(300_000);

  it('F-9001 AC-20 (german-no-pack): with the display language de (the window reports de) and no language pack installed, the pack’s row shows the English values of package.nls.json, and nothing about the pack interrupts', async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensionpack-german',
    );
    mkdirSync(folder, {recursive: true});
    const window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes(ENGLISH.displayName),
        ),
      30_000,
    );
    const found = await extensionRowOf(window, ENGLISH.displayName);
    deepStrictEqual(
      {
        language: await displayLanguageOf(window),
        entry: [found.name, found.description],
        interrupted: {
          notifications: await notifications(window),
          dialog: await dialogOf(window),
        },
      },
      {
        language: 'de',
        entry: [ENGLISH.displayName, ENGLISH.description],
        interrupted: {notifications: [], dialog: undefined},
      },
    );
    await closeWindow(window);
  });
});
