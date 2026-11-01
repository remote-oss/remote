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
  nlsLanguageOf,
  notifications,
} from '../windows/renderer.ts';

/** The pack's folder and its tables: the English one, and the German one. */
const PACKAGE_FOLDER = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'remote-extensionpack',
);
const ENGLISH = JSON.parse(
  readFileSync(path.join(PACKAGE_FOLDER, 'package.nls.json'), 'utf8'),
) as {displayName: string; description: string};
const GERMAN = JSON.parse(
  readFileSync(path.join(PACKAGE_FOLDER, 'package.nls.de.json'), 'utf8'),
) as {displayName: string; description: string};

describe('the extension pack with a language pack active (card coverage-76)', function () {
  this.timeout(300_000);

  it('F-9001 AC-17 (language-pack): with the German language pack active the pack’s row shows the German display name and the description of its package.nls.de.json, and with a pack for a language it has no table for (hu) the values of package.nls.json', async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensionpack-language',
    );
    mkdirSync(folder, {recursive: true});
    const window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.some(
            entry =>
              entry === ENGLISH.displayName || entry === GERMAN.displayName,
          ),
        ),
      30_000,
    );
    const language = await displayLanguageOf(window);
    const expected = language === 'de' ? GERMAN : ENGLISH;
    const found = await extensionRowOf(window, expected.displayName);
    deepStrictEqual(
      {
        language: [language, await nlsLanguageOf(window)],
        entry: [found.name, found.description],
        interrupted: {
          notifications: await notifications(window),
          dialog: await dialogOf(window),
        },
      },
      {
        language: [language, language],
        entry: [expected.displayName, expected.description],
        interrupted: {notifications: [], dialog: undefined},
      },
    );
    await closeWindow(window);
  });
});
