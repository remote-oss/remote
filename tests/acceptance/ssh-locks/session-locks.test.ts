/**
 * @fileoverview The lock for the whole session (card #2820, F-2408 AC-5 and AC-40, ruling-2820-flock-session): in flock
 * mode the host lock exists while the window is connected and is gone a few seconds after it is closed. These rows assert
 * the spec and are red until the product holds the lock for the session; they are held off the pull request.
 */

import {deepStrictEqual} from 'node:assert';
import {closeWindow, waitFor} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  distinctLocks,
  INSTALL_LOCK,
  installedWith,
  TEMPORARY_LOCK,
} from './install-support.ts';
import {lookAtHost} from './lock-listing.ts';

/** Waits up to `milliseconds` for the host to hold no lock file, and tells which it held at the end. */
async function locksAfterWaiting(milliseconds: number): Promise<string[]> {
  let held: string[] = [];
  await waitFor(
    'the lock files to be gone',
    async () => {
      held = distinctLocks([await lookAtHost()]);
      return held.length === 0;
    },
    milliseconds,
  ).catch(() => undefined);
  return held;
}

describe('the host lock for the whole session (card #2820, F-2408)', function () {
  this.timeout(600_000);

  after(async () => {
    await closeAllButLocal();
  });

  it('F-2408 AC-5 (c2820-lock-session): the lock file is still there once the window has connected, and is gone after the window is closed', async () => {
    await installedWith('c2820-session', {}, async install => {
      const connected = distinctLocks([install.after]);
      await closeWindow('c2820-session');
      deepStrictEqual(
        {connected, closed: await locksAfterWaiting(30_000)},
        {connected: [INSTALL_LOCK], closed: []},
      );
    });
  });

  it('F-2408 AC-40 (c2820-tmp-session): with lockfilesInTmp true the /tmp lock exists for the whole connected session and is gone a few seconds after the window is closed', async () => {
    await installedWith(
      'c2820-tmp-session',
      {'remote.SSH.lockfilesInTmp': true},
      async install => {
        const connected = distinctLocks([install.after]);
        await new Promise(resolve => setTimeout(resolve, 20_000));
        const later = distinctLocks([await lookAtHost()]);
        await closeWindow('c2820-tmp-session');
        deepStrictEqual(
          {connected, later, closed: await locksAfterWaiting(15_000)},
          {connected: [TEMPORARY_LOCK], later: [TEMPORARY_LOCK], closed: []},
        );
      },
    );
  });
});
