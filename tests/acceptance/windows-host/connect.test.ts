/**
 * @fileoverview A window on the run's Windows SSH host (card #2652): `winhost`, Windows' OpenSSH Server on 127.0.0.1,
 * which the platform workflow's Windows job starts with key authentication and Windows PowerShell as its shell.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  openWindow,
  windowState,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';

describe('a window on the Windows SSH host (card #2652)', function () {
  this.timeout(INSTALL_MILLISECONDS + 120_000);

  it('contracts harness: a window on winhost, the Windows OpenSSH Server on 127.0.0.1, connects with no platform pick', async () => {
    await openWindow('winhost', 'wh-smoke');
    try {
      await connectedWithin('wh-smoke', INSTALL_MILLISECONDS);
      deepStrictEqual(
        (await windowState('wh-smoke')).remoteAuthority,
        'ssh-remote+winhost',
      );
    } finally {
      await closeWindow('wh-smoke').catch(() => undefined);
    }
  });
});
