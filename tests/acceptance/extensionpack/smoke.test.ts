import {deepStrictEqual} from 'node:assert';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  inWindow,
  waitFor,
} from '../windows/harness.ts';
import {extensionPageOf, extensionsViewSections} from '../windows/renderer.ts';

/** The pack's display name, and the two members it names. */
const PACK = 'Remote Development';
const MEMBERS = ['Dev Containers', 'Remote - SSH'];

describe('the extension pack launch', function () {
  this.timeout(300_000);

  it('extensionpack smoke: the pack and its two members are installed from their VSIXs with no gallery, and the pack’s page lists both members', async () => {
    const name = await openFolderWindow(
      devContainerFolder('extensionpack-smoke'),
    );
    await inWindow(name, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(name)).some(section =>
          section.entries.includes(PACK),
        ),
      30_000,
    );
    const installed = (await extensionsViewSections(name)).find(
      section => section.title === 'Installed',
    )?.entries;
    const page = await extensionPageOf(name, PACK);
    deepStrictEqual(
      {
        listed: [PACK, ...MEMBERS].map(
          entry => installed?.includes(entry) === true,
        ),
        title: page.title,
        pack: page.pack,
      },
      {
        listed: [true, true, true],
        title: PACK,
        pack: MEMBERS,
      },
    );
    await closeWindow(name);
  });
});
