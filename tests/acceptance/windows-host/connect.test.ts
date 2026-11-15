/**
 * @fileoverview A window on the run's Windows SSH host (card #2652): `winhost`, Windows' OpenSSH Server on 127.0.0.1,
 * which the platform workflow's Windows job starts with key authentication and Windows PowerShell as its shell. The
 * row connects in terminal mode, where a Windows host runs the PowerShell bootstrap; the shared session of the local
 * server runs no PowerShell script yet.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  windowState,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';

describe('a window on the Windows SSH host (card #2652)', function () {
  this.timeout(INSTALL_MILLISECONDS + 120_000);

  it('contracts harness: a window on winhost, the Windows OpenSSH Server on 127.0.0.1, connects in terminal mode with no platform pick', async () => {
    const saved = readUserSettings();
    await userSettings({'remote.SSH.useLocalServer': false});
    await openWindow('winhost', 'wh-smoke');
    try {
      await connectedWithin('wh-smoke', INSTALL_MILLISECONDS);
      deepStrictEqual(
        (await windowState('wh-smoke')).remoteAuthority,
        'ssh-remote+winhost',
      );
    } finally {
      await closeWindow('wh-smoke').catch(() => undefined);
      restoreUserSettings(saved);
    }
  });
});
