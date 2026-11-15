/**
 * @fileoverview The run's Windows SSH host (card #2652): `winhost`, Windows' OpenSSH Server on 127.0.0.1, which the
 * platform workflow's Windows job starts with key authentication and Windows PowerShell as its shell. The row reaches
 * it with plain `ssh` through the run's ssh_config, as the product's windows will.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {variable} from '../windows/harness.ts';

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
});
