/**
 * @fileoverview The legacy `remote.SSH.defaultExtensionsIfInstalledLocally` moves into the editor's
 * `remote.defaultExtensionsIfInstalledLocally` when an SSH window starts (card #2701, F-2506 6.3, BR-10): the user's
 * settings only, also when the connection fails, and never in a local window.
 */

import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
  openLocalWindow,
} from '../windows/maintenance.ts';

const LEGACY = 'remote.SSH.defaultExtensionsIfInstalledLocally';

const CORE = 'remote.defaultExtensionsIfInstalledLocally';

const MACHINE_FILE = `${DATA_FOLDER}/data/Machine/settings.json`;

/** The user's settings file as an object. */
function userSettingsNow(): Record<string, unknown> {
  return JSON.parse(readUserSettings() ?? '{}') as Record<string, unknown>;
}

/** The legacy and the editor's key of the user's settings now, `undefined` for a key that is not there. */
function keysNow(): {legacy: unknown; core: unknown} {
  const settings = userSettingsNow();
  return {legacy: settings[LEGACY], core: settings[CORE]};
}

/** The digest of a file of the host, or `missing` when it is not there. */
async function digestOnHost(file: string): Promise<string> {
  const text = await onHost(
    'sh',
    '-c',
    `if [ -f '${file}' ]; then cat '${file}'; else printf missing; fi`,
  );
  return createHash('sha256').update(text).digest('hex');
}

describe('the legacy extensions key moves into the editor’s key (card #2701, F-2506 6.3)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  beforeEach(async () => {
    await closeAllButLocal();
    saved = readUserSettings();
  });

  afterEach(async () => {
    await closeAllButLocal();
    restoreUserSettings(saved);
  });

  /** Opens window `name` on the harness host and gives the keys of the user's settings once it has connected. */
  async function afterSshWindow(
    name: string,
  ): Promise<{legacy: unknown; core: unknown}> {
    appendScript(dismissals(name));
    await openWindow('harness', name);
    await connectedWithin(name, 120_000);
    await waitFor(
      'the legacy key to be moved',
      () => keysNow().legacy === undefined,
      60_000,
    );
    return keysNow();
  }

  it('F-2506 AC-9 (c2701-ssh-window): an SSH window removes the legacy key and appends its items to the editor’s key, and a local window leaves the file as it is', async () => {
    await userSettings({[LEGACY]: ['x.y'], [CORE]: ['p.q']});
    const before = readUserSettings();
    await openLocalWindow('l2701', 'legacy');
    const afterLocal = readUserSettings();
    const keys = await afterSshWindow('s2701');
    deepStrictEqual(
      [afterLocal === before, keys],
      [true, {legacy: undefined, core: ['p.q', 'x.y']}],
    );
  });

  it('F-2506 AC-21 (c2701-case): the editor’s entries keep their spelling and a legacy item that differs by case only is not added', async () => {
    await userSettings({[LEGACY]: ['A.B', 'c.d'], [CORE]: ['a.b']});
    deepStrictEqual(await afterSshWindow('s2701c'), {
      legacy: undefined,
      core: ['a.b', 'c.d'],
    });
  });

  it('F-2506 AC-22 (c2701-empty): an empty legacy list with no editor key leaves the legacy key gone and the editor’s key an empty list', async () => {
    await userSettings({[LEGACY]: [], [CORE]: undefined});
    deepStrictEqual(await afterSshWindow('s2701e'), {
      legacy: undefined,
      core: [],
    });
  });

  it('F-2506 AC-23 (c2701-other-scopes): the legacy key in the remote folder’s workspace settings and the remote Machine settings alone leaves the user settings and both files unchanged', async () => {
    const folder = '/home/harness/s2701w';
    await onHost(
      'sh',
      '-c',
      `mkdir -p '${folder}/.vscode' '${DATA_FOLDER}/data/Machine' && printf '%s' '{"${LEGACY}": ["w.x"]}' > '${folder}/.vscode/settings.json' && printf '%s' '{"${LEGACY}": ["m.n"]}' > '${MACHINE_FILE}'`,
    );
    async function hashes(): Promise<string[]> {
      return [
        await digestOnHost(`${folder}/.vscode/settings.json`),
        await digestOnHost(MACHINE_FILE),
      ];
    }
    const before = {user: readUserSettings(), files: await hashes()};
    const logMark = connectionLog().length;
    try {
      appendScript(dismissals('s2701w'));
      await openWindow('harness', 's2701w');
      await connectedWithin('s2701w', 120_000);
      await waitFor(
        'the line that says no legacy key was found',
        () =>
          connectionLog()
            .slice(logMark)
            .some(line => line.includes('no legacy remote.SSH extensions key')),
        60_000,
      );
      deepStrictEqual(
        {user: readUserSettings(), files: await hashes()},
        before,
      );
    } finally {
      await onHost('sh', '-c', `rm -f '${MACHINE_FILE}'`).catch(
        () => undefined,
      );
    }
  });

  it('F-2506 AC-24 (c2701-refused): a host that refuses the connection still has the user settings migrated', async () => {
    await userSettings({[LEGACY]: ['x.y']});
    const mark = Date.now();
    appendScript(dismissals('s2701r'));
    await openWindow('refused', 's2701r');
    await waitFor(
      'the failure dialog',
      () =>
        recordLines('failureDialog', 's2701r').some(line => line.time >= mark),
      120_000,
    );
    await waitFor(
      'the legacy key to be moved',
      () => keysNow().legacy === undefined,
      60_000,
    );
    await closeWindow('s2701r').catch(() => undefined);
    deepStrictEqual(keysNow(), {legacy: undefined, core: ['x.y']});
  });
});
