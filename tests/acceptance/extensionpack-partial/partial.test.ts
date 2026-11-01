import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  dialogOf,
  extensionPageOf,
  extensionsViewSections,
  notifications,
} from '../windows/renderer.ts';

/** The pack's display name, and the members of its first release. */
const PACK = 'Remote Development';
const MEMBER_COUNT = 2;

describe('the extension pack with a member missing and no gallery (card coverage-76)', function () {
  this.timeout(300_000);

  it('F-9101 AC-32 (member-missing): with Dev Containers not installed and the gallery unreachable, the pack’s page reads Extension Pack with the member count, shows no card, and nothing interrupts', async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensionpack-partial',
    );
    mkdirSync(folder, {recursive: true});
    const window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes(PACK),
        ),
      30_000,
    );
    const installed = (await extensionsViewSections(window)).flatMap(
      section => section.entries,
    );
    const page = await extensionPageOf(window, PACK);
    deepStrictEqual(
      {
        containersInstalled: installed.includes('Dev Containers'),
        header: page.packHeader,
        cards: page.pack,
        interrupted: {
          notifications: await notifications(window),
          dialog: await dialogOf(window),
        },
      },
      {
        containersInstalled: false,
        header: `Extension Pack (${String(MEMBER_COUNT)})`,
        cards: [],
        interrupted: {notifications: [], dialog: undefined},
      },
    );
    await closeWindow(window);
  });
});
