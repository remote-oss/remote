import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  dockerVolumes,
  inWindow,
  variable,
} from '../windows/harness.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

describe('F-0419 the vscode volume and the folder’s trust (card containers-53)', function () {
  this.timeout(600_000);

  it('F-0419 AC-29 (t29): cancelling core’s trust dialog creates no vscode volume', async () => {
    const {stdout: holders} = await execFileAsync('docker', [
      'ps',
      '--all',
      '--quiet',
      '--filter',
      'volume=vscode',
      '--filter',
      `label=remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
    ]);
    const held = holders.split('\n').filter(line => line !== '');
    if (held.length > 0) {
      await execFileAsync('docker', ['rm', '--force', ...held]);
    }
    await execFileAsync('docker', ['volume', 'rm', '--force', 'vscode']);
    const before = await dockerVolumes();
    const folder = devContainerFolder('trust-volume', {name: 'Trust Volume'});
    const name = await openFolderWindow(folder);
    const running = inWindow(name, 'remote-containers.reopenInContainer');
    await waitForDialog(name);
    await answerDialog(name, 'Cancel');
    await running;
    await new Promise(resolve => setTimeout(resolve, 2000));
    const after = await dockerVolumes();
    await closeWindow(name);
    deepStrictEqual(
      {before: before.includes('vscode'), after: after.includes('vscode')},
      {before: false, after: false},
    );
  });
});
