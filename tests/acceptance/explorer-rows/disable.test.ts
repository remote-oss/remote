/**
 * @fileoverview The Remote Explorer disabled in the Extensions view (F-5301 AC-24, card #3035): its activity-bar item and
 * its command go at once, Remote-SSH stays, and a restart of the window keeps it so. The row enables the explorer again
 * for the rows after it.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  extensionActive,
  inWindow,
  reloadWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  activityBarItems,
  extensionMenuAction,
  extensionsViewSections,
} from '../windows/renderer.ts';
import {explorerSurfaces, NO_EXPLORER} from '../windows/explorer-missing.ts';

/** The explorer's extension id. */
const EXPLORER = 'remote-oss.remote-explorer';

/** The display name of the explorer in the Extensions view. */
const EXPLORER_NAME = 'Remote Explorer';

/** Shows the Extensions view of window `name` once it lists the explorer, and chooses `action` of the entry's menu. */
async function chooseForExplorer(name: string, action: string): Promise<void> {
  await inWindow(name, 'workbench.view.extensions');
  await waitFor(
    `the Extensions view of window ${name} to list the explorer`,
    async () =>
      (await extensionsViewSections(name)).some(section =>
        section.entries.includes(EXPLORER_NAME),
      ),
    60_000,
  );
  await extensionMenuAction(name, EXPLORER_NAME, action);
}

describe('the Remote Explorer disabled in the Extensions view (card #3035)', function () {
  this.timeout(360_000);

  it('F-5301 AC-24 (disable): disabling the Remote Explorer removes its activity-bar item and its Show command at once, with no notification and Remote-SSH still listing the hosts, and a window restart keeps them absent', async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'explorer-rows',
      'x5301-disable',
    );
    mkdirSync(folder, {recursive: true});
    const name = await openFolderWindow(folder);
    try {
      // The window never showed the view, so the explorer has not activated: core disables an extension that is not
      // running at once, and asks for a restart for one that is.
      const inactive = !(await extensionActive(name, EXPLORER));
      const shown = (await activityBarItems(name)).some(label =>
        label.includes(EXPLORER_NAME),
      );
      await chooseForExplorer(name, 'Disable');
      await waitFor(
        `the Remote Explorer item to leave the activity bar of window ${name}`,
        async () =>
          !(await activityBarItems(name)).some(label =>
            label.includes(EXPLORER_NAME),
          ),
        30_000,
      );
      const disabled = await explorerSurfaces(name);
      await reloadWindow(name);
      const restarted = await explorerSurfaces(name);
      deepStrictEqual(
        [inactive, shown, disabled, restarted],
        [true, true, NO_EXPLORER, NO_EXPLORER],
      );
    } finally {
      await chooseForExplorer(name, 'Enable');
      await closeWindow(name);
    }
  });
});
