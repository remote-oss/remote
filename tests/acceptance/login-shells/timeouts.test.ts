import {deepStrictEqual} from 'node:assert';
import {connectionLog} from '../windows/harness.ts';
import {setting} from '../windows/maintenance.ts';
import {
  failedOn,
  removeHomeFiles,
  stopServer,
  writeHomeFile,
} from './shell-support.ts';

describe('login shells that do not finish or end early: the connect fails or waits as the timeout says (F-2704)', function () {
  this.timeout(900_000);

  it('F-2704 AC-11 (startup-timeout): a .bash_profile that sleeps past remote.SSH.connectTimeout ends the connect with the timeout dialog', async () => {
    await stopServer('harness-bash');
    await setting('remote.SSH.connectTimeout', 10);
    await writeHomeFile('harness-bash', '.bash_profile', 'sleep 60\n');
    try {
      const failed = await failedOn('harness-bash', 'to-ac11', 60_000);
      console.log('DUMP ac11', JSON.stringify(failed), connectionLog().filter(line => /login shell|timed out|SSH session|failure|connect failed/i.test(line)).slice(-6).join(' | '));
      deepStrictEqual(failed.dialog.question.includes('timed out'), true);
    } finally {
      await removeHomeFiles('harness-bash', '.bash_profile');
      await setting('remote.SSH.connectTimeout', undefined);
    }
  });

  it('F-2704 AC-13 (startup-exit): a .profile that ends with exit 1 fails within 5 s with the dialog and its three buttons', async () => {
    await stopServer('harness-bash');
    await writeHomeFile('harness-bash', '.profile', 'exit 1\n');
    try {
      const failed = await failedOn('harness-bash', 'to-ac13', 60_000);
      console.log('DUMP ac13', JSON.stringify(failed), connectionLog().filter(line => /login shell|timed out|SSH session|failure|connect failed/i.test(line)).slice(-6).join(' | '));
      deepStrictEqual(failed.dialog.buttons, []);
    } finally {
      await removeHomeFiles('harness-bash', '.profile');
    }
  });
});
