/**
 * @fileoverview The pre-connection dialog as a user sees it (F-2602 AC-19, AC-20): its left-most button on Linux is
 * Skip, which closes it, lets the connection continue and runs nothing, and a later connect asks again.
 */

import {chmodSync, existsSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';

describe('Skip in the pre-connection dialog (card #2700)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2602 AC-19, AC-20 (c2700-skip): Skip is the left-most button, pressing it connects without running the script, and a second connect shows the dialog again with the settings file unchanged', async () => {
    const script = path.join(variable('HARNESS_RUN_FOLDER'), 'c2700-skip.sh');
    const marker = `${script}.marker`;
    rmSync(marker, {force: true});
    writeFileSync(script, `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`);
    chmodSync(script, 0o755);
    await userSettings({
      'remote.SSH.remotePlatform': {harness: 'linux'},
      'remote.SSH.preconnect': script,
      'window.dialogStyle': 'custom',
    });
    const settings = readUserSettings();
    await openWindow('harness', 'c2700-first');
    const first = await waitForDialog('c2700-first', 120_000);
    await answerDialog('c2700-first', 'Skip');
    await connectedWithin('c2700-first', 120_000);
    const afterFirst = existsSync(marker);
    await closeWindow('c2700-first');
    await openWindow('harness', 'c2700-second');
    const second = await waitForDialog('c2700-second', 120_000);
    await answerDialog('c2700-second', 'Skip');
    await connectedWithin('c2700-second', 120_000);
    deepStrictEqual(
      {
        buttons: first.buttons,
        again: second.buttons,
        marker: afterFirst || existsSync(marker),
        settingsUnchanged: readUserSettings() === settings,
      },
      {
        buttons: ['Skip', "Allow and Don't Ask Again", 'Cancel', 'Allow'],
        again: ['Skip', "Allow and Don't Ask Again", 'Cancel', 'Allow'],
        marker: false,
        settingsUnchanged: true,
      },
    );
  });
});
