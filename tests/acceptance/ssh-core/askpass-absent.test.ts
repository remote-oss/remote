/**
 * @fileoverview The setting `remote.SSH.externalSSH_ASKPASS` turned on in a window whose editor has no `SSH_ASKPASS`
 * (F-2309): the extension has no program of the user's to leave alone, so it behaves as with the setting off.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {closeAllButLocal, password} from '../windows/maintenance.ts';
import {
  clearRecords,
  recorderPath,
  sshEnvironments,
  writeStandIns,
} from '../windows/askpass-support.ts';

describe('the setting for the user’s askpass program without an SSH_ASKPASS (card #2596, F-2309)', function () {
  this.timeout(300_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
    writeStandIns();
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2309 AC-7 (c2596-absent): with the setting true and no SSH_ASKPASS in the editor’s environment, the password is asked in the VS Code input and ssh runs with the extension’s own askpass and SSH_ASKPASS_REQUIRE=force', async () => {
    clearRecords();
    await userSettings({
      'remote.SSH.externalSSH_ASKPASS': true,
      'remote.SSH.path': recorderPath(),
      'remote.SSH.remotePlatform': {password: 'linux'},
    });
    appendScript([{...password(), window: 'as1'}]);
    await openWindow('password', 'as1');
    await connectedWithin('as1', 120_000);
    const logins = sshEnvironments().filter(
      each =>
        each.arguments.split(' ').includes('password') &&
        each.SSH_ASKPASS_REQUIRE !== '<unset>',
    );
    deepStrictEqual(
      {
        own: logins.map(each => each.SSH_ASKPASS !== '<unset>'),
        required: logins.map(each => each.SSH_ASKPASS_REQUIRE),
      },
      {own: [true], required: ['force']},
      JSON.stringify(sshEnvironments()),
    );
  });
});
