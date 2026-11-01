import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenStarted,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogKindOf,
  statusItem,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {downloadLogsText, logMarks, requestsSince} from '../genuine/genuine.ts';
import {licenceTexts, serversIn, statusOf} from './licence-support.ts';

/** How long a connect takes to reach the licence question: the image, the container and the CLI's run come before it. */
const DIALOG_MILLISECONDS = 300_000;

describe('the server licence of a genuine client with Dev Containers (card containers-124, F-1402)', function () {
  this.timeout(900_000);

  after(() => {
    console.log(downloadLogsText());
  });

  it('F-1402 AC-1 (licence-cancel): the first Reopen in Container in a fresh profile asks whether to accept the server’s licence terms, naming Dev Containers and the client, with the client’s terms address and Accept and Continue beside Cancel, before any request to the configured address; Cancel leaves no request, no server, the container stopped and the window disconnected', async () => {
    const folder = devContainerFolder('c124-licence', {name: 'Licence Cancel'});
    const name = await openFolderWindow(folder);
    try {
      const marks = logMarks();
      await reopenStarted(name);
      const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
      const asked = {
        kind: await dialogKindOf(name),
        message: dialog.message,
        details: dialog.details,
        buttons: dialog.buttons,
        requests: requestsSince(marks.requests),
      };
      await answerDialog(name, 'Cancel');
      const settled = await waitForDialog(name, 60_000).catch(() => undefined);
      const [containerId = ''] = await devContainersOf(folder);
      const after = {
        requests: requestsSince(marks.requests),
        servers: await serversIn(containerId),
        container: await statusOf(containerId),
        remoteName: (await windowState(name)).remoteName,
        dialog: settled && [settled.message, settled.details, settled.buttons],
        title: await windowTitle(name),
        indicator: (await statusItem(name, 'status.host')).text,
      };
      const texts = licenceTexts();
      deepStrictEqual(
        {asked, after},
        {
          asked: {
            kind: 'warning',
            message: texts.message,
            details: texts.details,
            buttons: ['Cancel', 'Accept and Continue'],
            requests: [],
          },
          after: {
            requests: [],
            servers: [],
            container: 'exited',
            remoteName: 'dev-container',
            dialog: undefined,
            title: '[c124-licence [Dev Container]]',
            indicator: 'Disconnected from Dev Container',
          },
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
