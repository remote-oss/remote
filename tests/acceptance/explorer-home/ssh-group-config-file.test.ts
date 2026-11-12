/**
 * @fileoverview F-2203 AC-19 (card coverage-119): the "SSH" row's "Open SSH Config File" button opens the same picker
 * as the command of F-2203 AC-2, which the row dismisses again.
 */

import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import path from 'node:path';
import {
  closePick,
  pickShown,
  sshFolder,
  systemHosts,
  viewWindow,
} from '../windows/explorer-home.ts';
import {listing, VIEW} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {rowAction} from '../windows/renderer.ts';

/** The picker of F-2203 AC-2: its question and its items, the user file first. */
const PICKER_QUESTION = 'Select SSH configuration file to update';
const SYSTEM_FILE = '/etc/ssh/ssh_config';
const PICKER_ITEMS_AFTER_FILES = ['Settings', 'Help'];

describe('Open SSH Config File by the SSH row (card coverage-119, F-2203 AC-19)', function () {
  this.timeout(300_000);

  it('F-2203 AC-19 (c119-row-config-file): the SSH row button opens the picker of AC-2, the same question and items in the same order', async () => {
    const saved = readUserSettings();
    const userFile = path.join(sshFolder(), 'config');
    rmSync(sshFolder(), {recursive: true, force: true});
    await userSettings({'remote.SSH.configFile': ''});
    const window = await viewWindow('c119-row-config-file');
    try {
      await listing(window, systemHosts());
      await rowAction(window, VIEW, 'SSH', 'Open SSH Config File');
      const shown = await pickShown(window);
      await closePick(window);
      deepStrictEqual(
        [shown.title, shown.placeholder, shown.rows],
        [
          '',
          PICKER_QUESTION,
          [userFile, SYSTEM_FILE, ...PICKER_ITEMS_AFTER_FILES],
        ],
      );
    } finally {
      await closeWindow(window);
      restoreUserSettings(saved);
      rmSync(sshFolder(), {recursive: true, force: true});
    }
  });
});
