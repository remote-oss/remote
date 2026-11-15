/**
 * @fileoverview The user's own askpass program at a reconnection (F-2309): "Kill Local Connection Server For Host..." ends
 * the connection of a connected window, which then logs in again with what the setting says at that time.
 */

import {deepStrictEqual} from 'node:assert';
import {
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  chooseQuickPickRow,
  inputBoxOf,
  pageText,
  pressEscape,
  quickPickOf,
  statusBarText,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  answering,
  askpassCalls,
  clearRecords,
  passwordRule,
  sshEnvironments,
  watchedConnect,
  writeStandIns,
} from '../windows/askpass-support.ts';

/** The setting of the feature. */
const EXTERNAL = 'remote.SSH.externalSSH_ASKPASS';

/** The platform of the password host, so that the platform question of F-2206 is not asked first. */
const PLATFORMS = {'remote.SSH.remotePlatform': {password: 'linux'}};

/** What the ssh recorder saw, for a failure of a row to name. */
function recorded(): string {
  return JSON.stringify({
    logins: sshEnvironments(),
    calls: askpassCalls().length,
  });
}

/** Runs Kill Local Connection Server For Host... in window `name` and picks the host `alias`. */
async function killLocalServer(name: string, alias: string): Promise<void> {
  void inWindow(name, 'opensshremotes.cleanLocalServer').catch(() => undefined);
  await waitForQuickPick(name, 30_000);
  await chooseQuickPickRow(name, alias);
}

/** The logins of ssh to `alias`: its recorded environments. */
function loginsTo(alias: string) {
  return sshEnvironments().filter(each =>
    each.arguments.split(' ').includes(alias),
  );
}

describe('the user’s own askpass program at a reconnection (card #2596, F-2309)', function () {
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

  it('F-2309 AC-10 (c2596-kill-server): a setting changed while connected applies to the login after Kill Local Connection Server: the extension’s own askpass asks in a VS Code input, and the program is not called', async () => {
    await userSettings({[EXTERNAL]: true, ...PLATFORMS});
    answering([passwordRule()]);
    await watchedConnect('password', 'as1', 120_000);
    const before = loginsTo('password').length;
    const called = askpassCalls().length;
    await userSettings({[EXTERNAL]: false});
    await killLocalServer('as1', 'password');
    await waitFor(
      'the password input of the new login',
      async () =>
        ((await inputBoxOf('as1').catch(() => undefined))?.placeholder ?? '')
          .toLowerCase()
          .includes('password'),
      120_000,
    );
    const logins = loginsTo('password')
      .slice(before)
      .filter(each => each.SSH_ASKPASS_REQUIRE !== '<unset>');
    deepStrictEqual(
      {
        required: [...new Set(logins.map(each => each.SSH_ASKPASS_REQUIRE))],
        newCalls: askpassCalls().length - called,
      },
      {required: ['force'], newCalls: 0},
      recorded(),
    );
    await pressEscape('as1').catch(() => undefined);
  });

  it('F-2309 AC-13 (c2596-reconnect-fails): a program that fails at the reconnection of a connected window gives core’s "Cannot reconnect. Please reload the window." and no VS Code input', async () => {
    await userSettings({[EXTERNAL]: true, ...PLATFORMS});
    answering([passwordRule()]);
    await watchedConnect('password', 'as1', 120_000);
    answering([{match: 'password', answer: '', status: 1}]);
    await killLocalServer('as1', 'password');
    await waitFor(
      'core’s reconnect failure',
      async () =>
        (await pageText('as1').catch(() => '')).includes('Cannot reconnect'),
      180_000,
    );
    const input = await inputBoxOf('as1').catch(() => undefined);
    const pick = await quickPickOf('as1').catch(() => undefined);
    deepStrictEqual(
      {
        inputs: [input?.placeholder ?? '', pick?.placeholder ?? ''].filter(
          label => label !== '',
        ),
      },
      {inputs: []},
      `${recorded()} ${await statusBarText('as1', 'status.host').catch(() => '')}`,
    );
  });
});
