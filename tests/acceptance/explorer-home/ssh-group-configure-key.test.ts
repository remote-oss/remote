/**
 * @fileoverview F-5002 AC-17 (card explorer-11, #1969): `remote-explorer.configureSsh` pressed by a key with no
 * argument opens the same companion picker as the "SSH" row's button, and shows no warning.
 */

import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import {bindKeys} from '../windows/explorer-folders.ts';
import {
  closePick,
  pickShown,
  sshFolder,
  systemHosts,
  viewWindow,
} from '../windows/explorer-home.ts';
import {hostLabels, listing, VIEW} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {
  notifications,
  pressControlAlt,
  rowAction,
} from '../windows/renderer.ts';

describe('Open SSH Config File by a key (card explorer-11, F-5002 AC-17)', function () {
  this.timeout(300_000);

  it('F-5002 AC-17 (configure-key-picker): the key of configureSsh with the view shown opens the picker the SSH row’s button opens, with no notification', async () => {
    const saved = readUserSettings();
    rmSync(sshFolder(), {recursive: true, force: true});
    await userSettings({'remote.SSH.configFile': ''});
    const window = await viewWindow('configure-key-picker');
    try {
      await listing(window, systemHosts());
      await rowAction(window, VIEW, 'SSH', 'Open SSH Config File');
      const fromButton = await pickShown(window);
      await closePick(window);
      const restore = await bindKeys([
        {key: 'ctrl+alt+j', command: 'remote-explorer.configureSsh'},
      ]);
      try {
        await pressControlAlt(window, 'j');
        const fromKey = await pickShown(window);
        await closePick(window);
        deepStrictEqual(
          [fromKey, await notifications(window), await hostLabels(window)],
          [fromButton, [], systemHosts()],
        );
      } finally {
        restore();
      }
    } finally {
      await closeWindow(window);
      restoreUserSettings(saved);
      rmSync(sshFolder(), {recursive: true, force: true});
    }
  });
});
