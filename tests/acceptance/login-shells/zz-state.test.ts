import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {variable} from '../windows/harness.ts';
import {settingsText} from '../windows/maintenance.ts';

/** The settings a text holds that are set: a key the harness reset holds `null`, which the editor reads as unset. */
function setSettings(text: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(JSON.parse(text) as Record<string, unknown>).filter(
      ([, value]) => value !== null,
    ),
  );
}

/** The settings file as the launch started, read when the rows are loaded, before any of them runs. */
const SETTINGS_AT_START = setSettings(settingsText());

/** The one setting the extension may write: the platform of a host in the terminal mode (F-2206). */
const PLATFORM_SETTING = 'remote.SSH.remotePlatform';

/** The shells of the accounts of the launch, as a word of a key. */
const SHELL_NAME = /\b(?:bash|zsh|dash|ksh|csh|tcsh|fish|sh)\b/i;

/** Every key at every depth of a value, so that a host name or shell kept anywhere in it shows. */
function keysOf(value: unknown): string[] {
  return typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
    : [];
}

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
  it('F-2704 AC-17 (nothing-stored): the settings file holds what it held at the start, apart from the remote platform, and the extension’s global state has no key at any depth that holds a shell name', () => {
    const settings = Object.fromEntries(
      Object.entries(setSettings(settingsText())).filter(
        ([key]) => key !== PLATFORM_SETTING,
      ),
    );
    deepStrictEqual(
      {
        settings,
        state: keysOf(extensionState()).filter(key => SHELL_NAME.test(key)),
      },
      {settings: SETTINGS_AT_START, state: []},
    );
  });
});
