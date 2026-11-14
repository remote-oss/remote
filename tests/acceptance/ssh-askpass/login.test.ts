/**
 * @fileoverview The login through the user's own askpass program (F-2309, the setting `remote.SSH.externalSSH_ASKPASS`):
 * which program answers ssh's questions, and what the ssh client's environment holds, for a window that connects to the
 * password host in local-server mode.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  onHostAs,
  readUserSettings,
  restoreUserSettings,
  terminalsOf,
  variable,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  answering,
  askpassCalls,
  clearRecords,
  forgetHostKey,
  knownHostsOf,
  passwordRule,
  sshEnvironments,
  watchedConnect,
  withSettings,
  writeStandIns,
} from './support.ts';

/** The setting of the feature. */
const EXTERNAL = 'remote.SSH.externalSSH_ASKPASS';

/** The platform of the password host, so that the platform question of F-2206 is not asked first. */
const PLATFORMS = {
  'remote.SSH.remotePlatform': {password: 'linux', 'password-ask': 'linux'},
};

/** The user's program, which the launch's `SSH_ASKPASS` names. */
function usersProgram(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'askpass-bin', 'answer');
}

/** The `DISPLAY` the editor's environment holds, which the harness gave it. */
const EDITOR_DISPLAY = process.env.DISPLAY ?? '<unset>';

/** The `ssh` that logs in to the alias: the ones whose arguments name it. */
function loginsTo(alias: string) {
  return sshEnvironments().filter(each =>
    each.arguments.split(' ').includes(alias),
  );
}

/** What the ssh recorder saw, for a failure of a row to name. */
function recorded(): string {
  return JSON.stringify(sshEnvironments());
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
    await closeAllButLocal();
  });

  it('F-2309 AC-2, AC-3 (c2596-user-program): with the setting true and SSH_ASKPASS naming a program that answers the password, a window on the password host connects with no VS Code input, and ssh runs with the user’s SSH_ASKPASS, the editor’s DISPLAY and no askpass variable of the extension’s', async () => {
    await withSettings({[EXTERNAL]: true, ...PLATFORMS});
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
      recorded(),
    );
  });

  it('F-2309 AC-6, AC-29 (c2596-setting-off): with the setting false (the default) and SSH_ASKPASS set, the window asks for the password in a VS Code input, the user’s program is never called, and the login ssh runs with the extension’s own askpass and SSH_ASKPASS_REQUIRE=force', async () => {
    await withSettings({[EXTERNAL]: false, ...PLATFORMS});
    answering([passwordRule()]);
    const watched = await watchedConnect('password', 'as1', 30_000);
    const logins = sshEnvironments().filter(
      each => each.SSH_ASKPASS_REQUIRE !== '<unset>',
    );
    deepStrictEqual(
      {
        connected: watched.connected,
        inputs: watched.inputs.map(label =>
          label.includes('Enter password for'),
        ),
        called: askpassCalls().length,
        own: logins.map(each => each.SSH_ASKPASS !== usersProgram()),
        required: logins.map(each => each.SSH_ASKPASS_REQUIRE),
        display: [...new Set(logins.map(each => each.DISPLAY))],
      },
      {
        connected: false,
        inputs: [true],
        called: 0,
        own: [true],
        required: ['force'],
        display: [EDITOR_DISPLAY],
      },
      recorded(),
    );
  });

  it('F-2309 AC-4 (c2596-host-key): with the setting true and an unknown host key, the host-key question goes to the program and no VS Code input appears, and the key is in the known-hosts file afterwards', async () => {
    forgetHostKey('password_ask');
    await withSettings({[EXTERNAL]: true, ...PLATFORMS});
    answering([{match: 'continue connecting', answer: 'yes'}, passwordRule()]);
    const watched = await watchedConnect('password-ask', 'as1', 120_000);
    deepStrictEqual(
      {
        connected: watched.connected,
        inputs: watched.inputs,
        questions: askpassCalls().map(call =>
          /continue connecting/i.test(call.prompt),
        ),
        recorded:
          readFileSync(knownHostsOf('password_ask'), 'utf8').trim() !== '',
      },
      {
        connected: true,
        inputs: [],
        questions: [true, false],
        recorded: true,
      },
      JSON.stringify(askpassCalls()),
    );
  });

  it('F-2309 AC-17 (c2596-folder-value): a true in the folder’s .vscode/settings.json is ignored: with the user value false the VS Code password input appears', async () => {
    await onHostAs(
      'harness',
      'sh',
      '-c',
      'mkdir -p /home/harness/af1/.vscode && chmod a+rwx /home/harness/af1 && printf \'{"remote.SSH.externalSSH_ASKPASS": true}\' > /home/harness/af1/.vscode/settings.json',
    );
    await withSettings({[EXTERNAL]: false, ...PLATFORMS});
    answering([passwordRule()]);
    const watched = await watchedConnect('password', 'af1', 30_000);
    deepStrictEqual(
      {
        inputs: watched.inputs.map(label =>
          label.includes('Enter password for'),
        ),
        called: askpassCalls().length,
      },
      {inputs: [true], called: 0},
      recorded(),
    );
  });

  for (const [title, extra] of [
    ['AC-19 (c2596-terminal-mode)', {'remote.SSH.useLocalServer': false}],
    [
      'AC-22 (c2596-socket-mode)',
      {'remote.SSH.remoteServerListenOnSocket': true},
    ],
  ] as const) {
    it(`F-2309 ${title}: in terminal mode the setting has no effect: the VS Code password input appears and the user’s program is not called`, async () => {
      await withSettings({[EXTERNAL]: true, ...PLATFORMS, ...extra});
      answering([passwordRule()]);
      const watched = await watchedConnect('password', 'as1', 40_000);
      deepStrictEqual(
        {
          inputs: watched.inputs.map(label =>
            label.includes('Enter password for'),
          ),
          called: askpassCalls().length,
        },
        {inputs: [true], called: 0},
        recorded(),
      );
    });
  }

  for (const [title, extra] of [
    ['AC-23 (c2596-no-exec-server)', {'remote.SSH.useExecServer': false}],
    ['AC-23 (c2596-login-terminal)', {'remote.SSH.showLoginTerminal': true}],
  ] as const) {
    it(`F-2309 ${title}: the program is called, no VS Code input and no install login terminal appear, and the window connects`, async () => {
      await withSettings({[EXTERNAL]: true, ...PLATFORMS, ...extra});
      answering([passwordRule()]);
      const watched = await watchedConnect('password', 'as1', 120_000);
      deepStrictEqual(
        {
          connected: watched.connected,
          inputs: watched.inputs,
          called: askpassCalls().length > 0,
          terminals: ((await terminalsOf('as1')) ?? []).filter(
            name => name === 'install',
          ),
        },
        {connected: true, inputs: [], called: true, terminals: []},
        recorded(),
      );
    });
  }
});
