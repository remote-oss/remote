/**
 * @fileoverview The login through the user's own askpass program (F-2309, the setting `remote.SSH.externalSSH_ASKPASS`):
 * which program answers ssh's questions, and what the ssh client's environment holds, for a window that connects to the
 * password host in local-server mode.
 */

import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  closeContained,
  readUserSettings,
  restoreUserSettings,
  variable,
} from '../windows/harness.ts';
import {pressEscape} from '../windows/renderer.ts';
import {
  answering,
  askpassCalls,
  clearRecords,
  passwordRule,
  sshEnvironments,
  watchedConnect,
  withSettings,
  writeStandIns,
} from './support.ts';

/** The setting of the feature. */
const EXTERNAL = 'remote.SSH.externalSSH_ASKPASS';

/** The user's program, which the launch's `SSH_ASKPASS` names. */
function usersProgram(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'askpass-bin', 'answer');
}

/** The `DISPLAY` the editor's environment holds, which the harness gave it. */
const EDITOR_DISPLAY = process.env.DISPLAY ?? '<unset>';

/** The `ssh` that logs in to the alias `password`: the one whose arguments name it. */
function loginsTo(alias: string) {
  return sshEnvironments().filter(each =>
    each.arguments.split(' ').includes(alias),
  );
}

describe('the login through the user’s own askpass program (card #2596, F-2309)', function () {
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
    for (const name of ['as1', 'as2']) {
      await closeContained(name, pressEscape).catch(() => undefined);
    }
  });

  it('F-2309 AC-2, AC-3 (c2596-user-program): with the setting true and SSH_ASKPASS naming a program that answers the password, a window on the password host connects with no VS Code input, and ssh runs with the user’s SSH_ASKPASS, the editor’s DISPLAY and no askpass variable of the extension’s', async () => {
    await withSettings({[EXTERNAL]: true});
    answering([passwordRule()]);
    const watched = await watchedConnect('password', 'as1', 120_000);
    deepStrictEqual(
      {
        connected: watched.connected,
        inputs: watched.inputs,
        called: askpassCalls().length > 0,
        asked: askpassCalls().every(call => /password/i.test(call.prompt)),
        askpass: [
          ...new Set(loginsTo('password').map(each => each.SSH_ASKPASS)),
        ],
        display: [...new Set(loginsTo('password').map(each => each.DISPLAY))],
        required: [
          ...new Set(
            loginsTo('password').map(each => each.SSH_ASKPASS_REQUIRE),
          ),
        ],
      },
      {
        connected: true,
        inputs: [],
        called: true,
        asked: true,
        askpass: [usersProgram()],
        display: [EDITOR_DISPLAY],
        required: ['<unset>'],
      },
    );
  });

  it('F-2309 AC-6, AC-29 (c2596-setting-off): with the setting false (the default) and SSH_ASKPASS set, the window asks for the password in a VS Code input, the user’s program is never called, and ssh runs with the extension’s own askpass and SSH_ASKPASS_REQUIRE=force', async () => {
    await withSettings({[EXTERNAL]: false});
    answering([passwordRule()]);
    const watched = await watchedConnect('password', 'as1', 30_000);
    deepStrictEqual(
      {
        connected: watched.connected,
        inputs: watched.inputs.map(label =>
          label.includes('Enter password for'),
        ),
        called: askpassCalls().length,
        own: [
          ...new Set(
            loginsTo('password').map(
              each => each.SSH_ASKPASS !== usersProgram(),
            ),
          ),
        ],
        required: [
          ...new Set(
            loginsTo('password').map(each => each.SSH_ASKPASS_REQUIRE),
          ),
        ],
      },
      {
        connected: false,
        inputs: [true],
        called: 0,
        own: [true],
        required: ['force'],
      },
    );
  });
});
