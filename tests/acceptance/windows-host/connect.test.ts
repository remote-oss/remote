/**
 * @fileoverview The run's Windows SSH host (card #2652): `winhost`, Windows' OpenSSH Server on 127.0.0.1, which the
 * platform workflow's Windows job starts with key authentication and Windows PowerShell as its shell. The first row
 * reaches it with plain `ssh` through the run's ssh_config, as the product's windows will; the second opens a window on
 * `winhost-unknown`, which has no platform stored, and the third on `winhost`, whose platform the launch stores as Windows;
 * the launch permits pseudo-terminals, so no row writes a setting.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {recordLines, variable} from '../windows/harness.ts';
import {connectedOnWinhost} from './winhost-support.ts';

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

  it('F-2701 AC-1 (c1835-windows-detect): with no platform stored, a window on winhost-unknown asks no platform pick, the opening finds Windows, the log names it, and the window is on the remote', async function () {
    this.timeout(600_000);
    const {logged} = await connectedOnWinhost(
      'winhost-unknown',
      'c1835-win',
      lines => lines.includes('Platform: windows'),
    );
    deepStrictEqual(
      [
        recordLines('platformPick', 'c1835-win'),
        logged.filter(line => line.startsWith('Platform: ')),
      ],
      [[], ['Platform: windows']],
    );
  });

  it('F-2106 AC-14 (ruling-1606-no-tty-warning): on a host decided as Windows, with the setting on and no RequestTTY in the shared mode, the connection command has no -T, ssh writes no warning, and the window connects', async function () {
    this.timeout(600_000);
    const {commands, logged} = await connectedOnWinhost(
      'winhost',
      'r1606-win',
      () => true,
    );
    deepStrictEqual(
      [
        commands.length > 0,
        commands.some(command => command.split(' ').includes('-T')),
        logged.filter(line => line.includes('Pseudo-terminal')),
      ],
      [true, false, []],
    );
  });
});
