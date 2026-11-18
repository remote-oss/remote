/**
 * @fileoverview The host's lock files while a window installs and after (card #2820, F-2408 card B): where the lock is
 * (the install folder, or `/tmp` with `remote.SSH.lockfilesInTmp`) and that `remote.SSH.useFlock` false gives the two names
 * of `ln` with link count 2, gone once the window has connected. The launch names no CLI source, so the install is the script's
 * with its host lock; the download is the run's slow source, so the install lasts about a minute and is looked at once a
 * second. The rows assert the names of the spec (F-2408 BR-1).
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
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
import {type Install, lookAtHost, lookedAtWhile} from './lock-listing.ts';

/** The install lock in the install folder: 0 bytes, one name. */
const INSTALL_LOCK =
  '<data>/bin/<commit>/vscode-remote-lock.harness.<commit>|0|1';

/** The install lock in `/tmp`: 0 bytes, one name. */
const TEMPORARY_LOCK = '/tmp/vscode-remote-lock.harness.<commit>|0|1';

/** The two names `ln` gives the lock: 0 bytes, link count 2. */
const LINKED_LOCKS = [
  '<data>/bin/<commit>/vscode-remote-lock.harness.<commit>.target|0|2',
  '<data>/bin/<commit>/vscode-remote-lock.harness.<commit>|0|2',
];

/** How many looks an install must have been seen through for the row to have watched it: the slow source lasts a minute. */
const LEAST_LOOKS = 10;

/** The distinct lock entries of `looks`, the commit written as `<commit>`, in order. */
function distinctLocks(looks: ReadonlyArray<{locks: string[]}>): string[] {
  return [
    ...new Set(
      looks.flatMap(look =>
        look.locks.map(lock => lock.replaceAll(/[0-9a-f]{40}/gu, '<commit>')),
      ),
    ),
  ].toSorted();
}

/**
 * Installs on a fresh host in the window `name` with `settings` in legacy mode and gives the looks of the install; `body`
 * runs with the window still open, and the window is closed after it.
 */
async function installedWith<Result>(
  name: string,
  settings: Readonly<Record<string, unknown>>,
  body: (install: Install) => Promise<Result>,
): Promise<Result> {
  const saved = readUserSettings();
  try {
    await freshHost();
    await onHost('sh', '-c', 'rm -f /tmp/*remote-lock.*');
    await userSettings({
      ...PLATFORMS,
      'remote.SSH.serverDownloadUrlTemplate': `${variable('HARNESS_DOWNLOADS_HTTP')}/slow/\${os}-\${arch}/\${commit}`,
      'remote.SSH.useExecServer': false,
      ...settings,
    });
    appendScript(dismissals(name));
    const install = await lookedAtWhile(
      (async () => {
        await openWindow('harness', name);
        await connectedWithin(name, INSTALL_MILLISECONDS);
      })(),
    );
    deepStrictEqual(
      install.during.length >= LEAST_LOOKS,
      true,
      `the install of ${name} was looked at ${String(install.during.length)} times, fewer than ${String(LEAST_LOOKS)}`,
    );
    return await body(install);
  } finally {
    await closeWindow(name).catch(() => undefined);
    restoreUserSettings(saved);
  }
}

describe('the host lock files (card #2820, F-2408)', function () {
  this.timeout(600_000);

  after(async () => {
    await closeAllButLocal();
  });

  it('c2820-listing-sees: the listing sees a lock-named file where one is, with its size and link count, whichever find and stat the host has, so an empty list means none', async () => {
    const name = '/tmp/vscode-remote-lock.harness.c2820probe';
    await onHost('sh', '-c', `: > ${name}`);
    try {
      deepStrictEqual((await lookAtHost()).locks, [`${name}|0|1`]);
    } finally {
      await onHost('rm', '-f', name);
    }
  });

  it('F-2408 AC-4, AC-29 (c2820-install-lock-false): with useExecServer false and the default lock settings the install holds one 0-byte lock file in the install folder of the data folder and none in /tmp', async () => {
    await installedWith(
      'c2820-lock-false',
      {'remote.SSH.useExecServer': false},
      install => {
        deepStrictEqual(distinctLocks(install.during), [INSTALL_LOCK]);
        return Promise.resolve();
      },
    );
  });

  it('F-2408 AC-4, AC-29 (c2820-install-lock-true): with useExecServer true and the default lock settings the install holds one 0-byte lock file in the install folder of the data folder and none in /tmp', async () => {
    await installedWith(
      'c2820-lock-true',
      {'remote.SSH.useExecServer': true},
      install => {
        deepStrictEqual(distinctLocks(install.during), [INSTALL_LOCK]);
        return Promise.resolve();
      },
    );
  });

  it('F-2408 AC-7 (c2820-lock-tmp): with lockfilesInTmp true the lock file is in /tmp and the install folder holds none', async () => {
    await installedWith(
      'c2820-tmp',
      {'remote.SSH.lockfilesInTmp': true},
      install => {
        deepStrictEqual(distinctLocks(install.during), [TEMPORARY_LOCK]);
        return Promise.resolve();
      },
    );
  });

  it('F-2408 AC-8 (c2820-lock-ln): with useFlock false the lock location holds the two names of ln, 0 bytes with link count 2, during the install, and none once the window is connected', async () => {
    await installedWith('c2820-ln', {'remote.SSH.useFlock': false}, install => {
      deepStrictEqual(
        [distinctLocks(install.during), distinctLocks([install.after])],
        [LINKED_LOCKS, []],
      );
      return Promise.resolve();
    });
  });
});
