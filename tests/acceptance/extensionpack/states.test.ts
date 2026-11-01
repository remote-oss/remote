import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  extensionFeaturesOf,
  extensionPageOf,
  extensionsViewSections,
  notifications,
  pageText,
  quickPickRows,
} from '../windows/renderer.ts';

/** The pack's display name and id. */
const PACK = 'Remote Development';
const PACK_ID = 'remote-oss.vscode-remote-extensionpack';

describe('the extension pack with the gallery unreachable (card coverage-76)', function () {
  this.timeout(300_000);

  let window = '';

  before(async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensionpack-states',
    );
    mkdirSync(folder, {recursive: true});
    window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes(PACK),
        ),
      30_000,
    );
  });

  after(async () => {
    await closeWindow(window);
  });

  it('F-9101 AC-22 (features): the FEATURES tab of the pack’s page shows only No features contributed.', async () => {
    await extensionPageOf(window, PACK);
    deepStrictEqual(
      await extensionFeaturesOf(window),
      'No features contributed.',
    );
  });

  it('F-9101 AC-24 (quick-open): typing ext install and the pack’s id in Quick Open offers only the line to search for it', async () => {
    void inWindow(
      window,
      'workbench.action.quickOpen',
      `ext install ${PACK_ID}`,
    ).catch(() => undefined);
    await waitFor(
      'the Quick Open list',
      async () => (await quickPickRows(window)).length > 0,
      30_000,
    );
    deepStrictEqual(
      (await quickPickRows(window)).map(found => found.label),
      [`Press Enter to search for extension '${PACK_ID}'.`],
    );
    await inWindow(window, 'workbench.action.closeQuickOpen');
  });

  it('F-9101 AC-14 (search-error): a search of the Marketplace lists the line Error while fetching extensions with the network error, and no notification', async () => {
    await inWindow(window, 'workbench.extensions.search', 'python');
    await waitFor(
      'the fetch error line',
      async () =>
        (await pageText(window)).includes('Error while fetching extensions.'),
      60_000,
    );
    deepStrictEqual(
      {
        lines: [
          ...new Set(
            (await pageText(window))
              .split('\n')
              .filter(line =>
                line.startsWith('Error while fetching extensions.'),
              ),
          ),
        ],
        notifications: await notifications(window),
      },
      {
        lines: ['Error while fetching extensions. Failed to fetch'],
        notifications: [],
      },
    );
  });
});
