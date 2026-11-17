/**
 * @fileoverview The run's Windows SSH host (card #2652): `winhost`, Windows' OpenSSH Server on 127.0.0.1, which the
 * platform workflow's Windows job starts with key authentication and Windows PowerShell as its shell. The first row
 * reaches it with plain `ssh` through the run's ssh_config, as the product's windows will; the second opens a window on
 * it with no platform stored.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectionLog,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';

const execFileAsync = promisify(execFile);

describe('the Windows SSH host of the run (card #2652)', function () {
  this.timeout(60_000);

  it('contracts harness: winhost answers plain ssh through the run’s ssh_config with the run’s key, in Windows PowerShell', async () => {
    const {stdout} = await execFileAsync('ssh', [
      '-F',
      variable('HARNESS_SSH_CONFIG'),
      'winhost',
      '$PSVersionTable.PSEdition',
    ]);
    deepStrictEqual(stdout.trim(), 'Desktop');
  });

  it('F-2701 AC-1 (c1835-windows-detect): with no platform stored, a window on winhost asks no platform pick, the opening finds Windows, the log names it, and the window is on the remote', async function () {
    this.timeout(600_000);
    const saved = readUserSettings();
    await userSettings({'remote.SSH.remotePlatform': {}});
    const mark = connectionLog().length;
    try {
      await openWindow('winhost', 'c1835-win');
      await waitFor(
        'c1835-win to be on the remote with the platform logged',
        async () =>
          (await windowState('c1835-win')).remoteName === 'ssh-remote' &&
          connectionLog().slice(mark).includes('Platform: windows'),
        480_000,
      );
      deepStrictEqual(
        [
          recordLines('platformPick', 'c1835-win'),
          connectionLog()
            .slice(mark)
            .filter(line => line.startsWith('Platform: ')),
        ],
        [[], ['Platform: windows']],
      );
    } finally {
      await closeWindow('c1835-win').catch(() => undefined);
      restoreUserSettings(saved);
      await userSettings({});
    }
  });
});
