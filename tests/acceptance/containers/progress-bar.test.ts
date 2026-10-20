import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  editorProduct,
  reopenInContainer,
  variable,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  type ConnectingToast,
  notificationProgress,
} from '../windows/renderer.ts';

const CONNECTING = 'Connecting to Dev Container';

describe('the connect progress bar (card containers-55)', function () {
  this.timeout(600_000);

  it('containers-55 (d1): the connecting toast is determinate while it shows a stage, and keeps the stage text', async () => {
    const folder = devContainerFolder('c55-bar', {name: 'Bar One'});
    const name = await openFolderWindow(folder);
    try {
      const seen: ConnectingToast[] = [];
      const gate = {done: false};
      const sampler = (async () => {
        while (!gate.done) {
          try {
            const toast = await notificationProgress(name, CONNECTING);
            if (toast !== undefined) {
              seen.push(toast);
            }
          } catch {
            // The window is reloading.
          }
          await new Promise(resolve => setTimeout(resolve, 80));
        }
      })();
      await reopenInContainer(name);
      gate.done = true;
      await sampler;
      const staged = seen.filter(toast => toast.message.includes(': '));
      console.log(
        `containers-55 d1: ${JSON.stringify([...new Set(seen.map(toast => `${toast.message} [${toast.progress}]`))])}`,
      );
      deepStrictEqual(
        {
          sawAStage: staged.length > 0,
          stagedBars: [...new Set(staged.map(toast => toast.progress))],
        },
        {sawAStage: true, stagedBars: ['discrete']},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0503 AC-30 (installing-determinate): on a volume miss, the connecting toast is determinate each time it is read while Installing server shows', async () => {
    const execFileAsync = promisify(execFile);
    await execFileAsync('docker', [
      'run',
      '--rm',
      '-v',
      'vscode:/vscode',
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'sh',
      '-c',
      `rm -rf /vscode/*/bin/*/${editorProduct().commit}`,
    ]);
    const downloads = path.join(variable('HARNESS_RUN_FOLDER'), 'c56-slow');
    mkdirSync(downloads, {recursive: true});
    await setUserSetting('remote.serverDownloadFolder', downloads);
    await setUserSetting(
      'remote.serverDownloadBaseUrl',
      `${variable('HARNESS_DOWNLOADS_LOCAL')}/slow`,
    );
    const folder = devContainerFolder('c56-install', {name: 'Install One'});
    try {
      const name = await openFolderWindow(folder);
      const readings: ConnectingToast[] = [];
      const gate = {done: false};
      const sampler = (async () => {
        while (!gate.done) {
          try {
            const toast = await notificationProgress(name, CONNECTING);
            if (toast?.message.endsWith(': Installing server') === true) {
              readings.push(toast);
            }
          } catch {
            // The window is reloading.
          }
          await new Promise(resolve => setTimeout(resolve, 60));
        }
      })();
      await reopenInContainer(name, 600_000);
      gate.done = true;
      await sampler;
      deepStrictEqual(
        {
          read: readings.length >= 5,
          bars: [...new Set(readings.map(toast => toast.progress))],
        },
        {read: true, bars: ['discrete']},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
      await setUserSetting(
        'remote.serverDownloadBaseUrl',
        `${variable('HARNESS_DOWNLOADS_LOCAL')}/ok`,
      );
    }
  });
});
