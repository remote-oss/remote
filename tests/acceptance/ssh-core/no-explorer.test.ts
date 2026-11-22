/**
 * @fileoverview Remote-SSH and Remote - SSH: Editing Configuration Files without the Remote Explorer (F-5301 AC-10, card
 * #3035): the launch installs no explorer, as a user who uninstalled it has it.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, variable} from '../windows/harness.ts';
import {anyTypeStored} from '../windows/explorer-type.ts';
import {explorerSurfaces, NO_EXPLORER} from '../windows/explorer-missing.ts';

describe('Remote-SSH without the Remote Explorer (card #3035)', function () {
  this.timeout(180_000);

  it('F-5301 AC-10 (no-explorer): a local folder has no Remote Explorer activity-bar item, no "View: Show Remote Explorer" command, no notification and no remote.explorerType, and Connect to Host still lists the configured hosts', async () => {
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'x5301-no-explorer',
    );
    mkdirSync(folder, {recursive: true});
    const name = await openFolderWindow(folder);
    try {
      deepStrictEqual(
        [await explorerSurfaces(name), anyTypeStored()],
        [NO_EXPLORER, false],
      );
    } finally {
      await closeWindow(name);
    }
  });
});
