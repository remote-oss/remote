import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
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
} from '../windows/harness.ts';
import {notifications, statusItem} from '../windows/renderer.ts';

describe('a configuration file that cannot be parsed (card coverage-98)', function () {
  this.timeout(120_000);

  it('F-2201 AC-22: a connect with a file that cannot be parsed starts no ssh, leaves the window disconnected and shows an error that names the file and the parse problem', async () => {
    const saved = readUserSettings();
    const broken = path.join(variable('HARNESS_RUN_FOLDER'), 'cfg-broken');
    writeFileSync(broken, 'Host cfghost\n  HostName "unterminated\n');
    await userSettings({'remote.SSH.configFile': broken});
    const mark = connectionLog().length;
    try {
      await openWindow('cfghost', 'f22');
      await waitFor(
        'the error toast',
        async () => (await notifications('f22')).length > 0,
        30_000,
      );
      deepStrictEqual(
        {
          toasts: await notifications('f22'),
          indicator: (await statusItem('f22', 'status.host')).text,
          dialogs: recordLines('failureDialog', 'f22').length,
          sshChecked: connectionLog()
            .slice(mark)
            .some(line => line.startsWith('Checking ssh client:')),
        },
        {
          toasts: [
            `Failed to connect to the remote extension host server (Error: ${broken}: unterminated quote after HostName)`,
          ],
          indicator: 'Disconnected from SSH: cfghost',
          dialogs: 0,
          sshChecked: false,
        },
      );
    } finally {
      await closeWindow('f22').catch(() => undefined);
      restoreUserSettings(saved);
    }
  });
});
