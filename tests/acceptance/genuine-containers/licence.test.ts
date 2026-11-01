import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  editorProduct,
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

const execFileAsync = promisify(execFile);

/** The display name of Dev Containers, as its manifest gives it. */
const DISPLAY_NAME = (
  JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'remote-containers',
        'package.json',
      ),
      'utf8',
    ),
  ) as {displayName: string}
).displayName;

/** The pids of the VS Code server processes in container `containerId`, by their connection-token argument. */
async function serversIn(containerId: string): Promise<string[]> {
  // A container that is not running has no server in it.
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'sh',
    '-c',
    'for each in /proc/[0-9]*; do if tr "\\0" " " < "$each/cmdline" 2>/dev/null | grep -q -- "--connection-token-fil[e]"; then echo "${each#/proc/}"; fi; done',
  ]).catch(() => ({stdout: ''}));
  return stdout.split('\n').filter(line => line !== '');
}

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
        container: await execFileAsync('docker', [
          'inspect',
          '--format',
          '{{.State.Status}}',
          containerId,
        ]).then(each => each.stdout.trim()),
        remoteName: (await windowState(name)).remoteName,
        dialog: settled && [settled.message, settled.details, settled.buttons],
        title: await windowTitle(name),
        indicator: (await statusItem(name, 'status.host')).text,
      };
      const product = editorProduct();
      deepStrictEqual(
        {asked, after},
        {
          asked: {
            kind: 'warning',
            message: `${DISPLAY_NAME} needs you to accept the license terms of the ${product.applicationName} server before installing it.`,
            details: `Read the terms at ${product.serverLicenseUrl}.`,
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
