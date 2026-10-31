import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {variable} from '../windows/harness.ts';
import {settingsText} from '../windows/maintenance.ts';

/** The settings the run starts with and the ones its rows set themselves: any other key was written by the extension. */
const EXPECTED_SETTINGS = [
  'remote.SSH.configFile',
  'remote.SSH.connectTimeout',
  'remote.SSH.enableRemoteCommand',
  'remote.SSH.permitPtyAllocation',
  'remote.SSH.remotePlatform',
  'remote.SSH.showLoginTerminal',
  'remote.SSH.useExecServer',
  'remote.SSH.useLocalServer',
];

/** The shells of the accounts of the launch, as a word of a key. */
const SHELL_NAME = /\b(?:bash|zsh|dash|ksh|csh|tcsh|fish|sh)\b/i;

/** The Remote - SSH extension's global state: the entries it stored under its own key, by name. */
function extensionState(): Record<string, unknown> {
  const database = new DatabaseSync(
    path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'),
    {readOnly: true},
  );
  try {
    const stored = database
      .prepare('SELECT value FROM ItemTable WHERE key = ?')
      .get('remote-oss.remote-ssh') as {value: string} | undefined;
    return stored === undefined
      ? {}
      : (JSON.parse(stored.value) as Record<string, unknown>);
  } finally {
    database.close();
  }
}

describe('what the login-shell rows leave behind (card coverage-49)', () => {
  it('F-2704 AC-17 (nothing-stored): the settings file holds no key the rows did not set, and the extension’s global state has no key that holds a shell name', () => {
    deepStrictEqual(
      {
        settings: Object.keys(
          JSON.parse(settingsText()) as Record<string, unknown>,
        ).filter(key => !EXPECTED_SETTINGS.includes(key)),
        state: Object.keys(extensionState()).filter(key =>
          SHELL_NAME.test(key),
        ),
      },
      {settings: [], state: []},
    );
  });
});
