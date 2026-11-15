/**
 * @fileoverview The setting `remote.SSH.externalSSH_ASKPASS` in an editor whose environment holds an empty `SSH_ASKPASS`
 * and `SSH_ASKPASS_REQUIRE=never` (F-2309): with no program to leave alone the extension logs in as with the setting off,
 * whatever the setting says and the inherited `never`; in terminal mode it leaves both variables as inherited.
 */

import {deepStrictEqual} from 'node:assert';
import {
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
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

/** The environments of the `ssh` that logged in to the alias `password`. */
function logins() {
  return sshEnvironments().filter(
    each =>
      each.arguments.split(' ').includes('password') &&
      !each.arguments.includes(' -G '),
  );
}

/** What the ssh recorder saw, for a failure of a row to name. */
function recorded(): string {
  return JSON.stringify(sshEnvironments());
}

describe('the user’s askpass setting with an empty SSH_ASKPASS and SSH_ASKPASS_REQUIRE=never (card #2596, F-2309)', function () {
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

  /** The row of a login that is the extension's own: the input shows, and ssh runs with its askpass and `force`. */
  async function ownLoginRow(value: boolean): Promise<void> {
    await userSettings({[EXTERNAL]: value, ...PLATFORMS});
    answering([passwordRule()]);
    const watched = await watchedConnect('password', 'as1', 40_000);
    const forced = logins().filter(
      each => each.SSH_ASKPASS_REQUIRE !== 'never',
    );
    deepStrictEqual(
      {
        inputs: watched.inputs.map(label =>
          label.includes('Enter password for'),
        ),
        called: askpassCalls().length,
        own: forced.map(each => each.SSH_ASKPASS !== ''),
        required: forced.map(each => each.SSH_ASKPASS_REQUIRE),
      },
      {inputs: [true], called: 0, own: [true], required: ['force']},
      recorded(),
    );
  }

  it('F-2309 AC-7, AC-16 (c2596-empty-never): with the setting true the password is asked in the VS Code input, and ssh runs with the extension’s own askpass and SSH_ASKPASS_REQUIRE=force', async () => {
    await ownLoginRow(true);
  });

  it('F-2309 AC-16 (c2596-never-off): with the setting false the password is asked in the VS Code input, and ssh runs with the extension’s own askpass and SSH_ASKPASS_REQUIRE=force', async () => {
    await ownLoginRow(false);
  });

  it('F-2309 AC-8 (c2596-terminal-inherited): in terminal mode the behaviour is the same with the setting true and false, and ssh keeps the inherited SSH_ASKPASS and SSH_ASKPASS_REQUIRE', async () => {
    const seen: Array<{inputs: string[]; env: string[]}> = [];
    for (const value of [true, false]) {
      clearRecords();
      await userSettings({
        [EXTERNAL]: value,
        'remote.SSH.useLocalServer': false,
        ...PLATFORMS,
      });
      answering([passwordRule()]);
      const watched = await watchedConnect('password', 'as1', 40_000);
      seen.push({
        inputs: watched.inputs.map(label =>
          label.includes('Enter password for') ? 'password' : label,
        ),
        env: [
          ...new Set(
            logins().map(
              each => `${each.SSH_ASKPASS}|${each.SSH_ASKPASS_REQUIRE}`,
            ),
          ),
        ],
      });
      await closeAllButLocal();
    }
    deepStrictEqual(
      seen,
      [
        {inputs: ['password'], env: ['|never']},
        {inputs: ['password'], env: ['|never']},
      ],
      recorded(),
    );
  });
});
