import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  devContainerFolder,
  reopenInContainer,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
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
});
