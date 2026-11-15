/**
 * @fileoverview The setting `remote.SSH.externalSSH_ASKPASS` in an editor whose `SSH_ASKPASS` is a single space (F-2309):
 * it counts as set, so the extension leaves it alone, and ssh finds no program of that name.
 */

import {deepStrictEqual} from 'node:assert';
import {
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {inputBoxOf, quickPickOf, waitForDialog} from '../windows/renderer.ts';
import {
  clearRecords,
  deniedDetails,
  knowHostKey,
  sshEnvironments,
  useOwnConfig,
  writeStandIns,
} from '../windows/askpass-support.ts';

describe('the user’s askpass setting with an SSH_ASKPASS of one space (card #2596, F-2309)', function () {
  this.timeout(300_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
    writeStandIns();
  });

  beforeEach(() => {
    clearRecords();
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2309 AC-25 (c2596-space): with the setting true, no VS Code input appears and the failure dialog names the permission denial', async () => {
    knowHostKey('askpass-pw');
    await userSettings({
      'remote.SSH.externalSSH_ASKPASS': true,
      ...useOwnConfig(),
    });
    await openWindow('askpass-pw', 'as1');
    const dialog = await waitForDialog('as1', 120_000);
    const input = await inputBoxOf('as1');
    const pick = await quickPickOf('as1');
    deepStrictEqual(
      {
        dialog,
        inputs: [input?.placeholder ?? '', pick?.placeholder ?? ''].filter(
          label => label !== '',
        ),
        askpass: [...new Set(sshEnvironments().map(each => each.SSH_ASKPASS))],
      },
      {
        dialog: {
          message: '',
          details: deniedDetails('askpass-pw'),
          buttons: ['Retry', 'More Actions...', 'Close Remote'],
        },
        inputs: [],
        askpass: [' '],
      },
      JSON.stringify(sshEnvironments()),
    );
  });
});
