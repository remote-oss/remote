/**
 * @fileoverview The host's lock files in the default exec-server mode (card #2820, F-2408 card B): no lock file appears on
 * the host in any combination of `remote.SSH.useFlock` and `remote.SSH.lockfilesInTmp`, and the connect succeeds. The
 * download is the run's slow source, so the install lasts about a minute and is looked at once a second.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  onHost,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';
import {lookAtHost, lookedAtWhile} from './lock-listing.ts';

/** How many looks an install must have been seen through for the row to have watched it: the slow source lasts a minute. */
const LEAST_LOOKS = 10;

/** Installs on a fresh host in the window `name` with `settings` and tells what the looks at the host found. */
async function installedWith(
  name: string,
  settings: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const saved = readUserSettings();
  try {
    await freshHost();
    await userSettings({
      ...PLATFORMS,
      'remote.SSH.serverDownloadUrlTemplate': `${variable('HARNESS_DOWNLOADS_HTTP')}/slow/\${os}-\${arch}/\${commit}`,
      ...settings,
    });
    const settingsBefore = readUserSettings();
    appendScript(dismissals(name));
    const install = await lookedAtWhile(
      (async () => {
        await openWindow('harness', name);
        await connectedWithin(name, INSTALL_MILLISECONDS);
      })(),
    );
    const everyLook = [...install.during, install.after];
    return {
      connected: true,
      watchedTheInstall: install.during.length >= LEAST_LOOKS,
      installSeen: everyLook.some(look => look.installs.length > 0),
      locksSeen: everyLook.flatMap(look => look.locks),
      settingsKept: readUserSettings() === settingsBefore,
    };
  } finally {
    restoreUserSettings(saved);
  }
}

describe('the host lock files in exec-server mode (card #2820, F-2408)', function () {
  this.timeout(600_000);

  after(async () => {
    await closeAllButLocal();
  });

  it('F-2408 AC-9 (c2820-exec-default): with the default settings an install on a fresh host leaves no lock file on the host, in the install folder or in /tmp, and the connect succeeds', async () => {
    deepStrictEqual(await installedWith('c2820-exec-default', {}), {
      connected: true,
      watchedTheInstall: true,
      installSeen: true,
      locksSeen: [],
      settingsKept: true,
    });
  });

  it('F-2408 AC-9 (c2820-exec-changed): with remote.SSH.lockfilesInTmp true and remote.SSH.useFlock false the install still leaves no lock file on the host, and the connect succeeds', async () => {
    deepStrictEqual(
      await installedWith('c2820-exec-changed', {
        'remote.SSH.lockfilesInTmp': true,
        'remote.SSH.useFlock': false,
      }),
      {
        connected: true,
        watchedTheInstall: true,
        installSeen: true,
        locksSeen: [],
        settingsKept: true,
      },
    );
  });

  it('F-2408 AC-9 (c2820-listing-sees): the listing sees a lock-named file where one is, so an empty list means none', async () => {
    const name = '/tmp/remote-lock.harness.c2820probe';
    await onHost('sh', '-c', `: > ${name}`);
    try {
      deepStrictEqual((await lookAtHost()).locks, [name]);
    } finally {
      await onHost('rm', '-f', name);
    }
  });
});
