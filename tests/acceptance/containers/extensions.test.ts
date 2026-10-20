import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {notificationCentre} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** How long the install may take after the window is connected: the window does not wait for it (F-0505 BR-8). */
const INSTALL_MILLISECONDS = 90_000;

/** The folder of the extension the configuration lists. */
const DRACULA_PREFIX = 'dracula-theme.theme-dracula-';

/** The folders of the extensions installed in container `containerId` for the remote user; none while there is no folder. */
async function installedIn(containerId: string): Promise<string[]> {
  try {
    const {stdout} = await execFileAsync('docker', [
      'exec',
      containerId,
      'sh',
      '-c',
      `ls "$(cd; pwd)/${editorProduct().serverDataFolderName}/extensions"`,
    ]);
    return stdout.split('\n').filter(entry => entry !== '');
  } catch {
    return [];
  }
}

describe('the configuration’s extensions in the container (card containers-16)', function () {
  this.timeout(600_000);

  it('F-0505 AC-1, AC-12, AC-34 (gate-row-12): an id of the configuration is installed in the new container without holding the window, and a malformed id beside it is no notice', async () => {
    const folder = devContainerFolder('gate-extensions', {
      customizations: {
        vscode: {extensions: ['dracula-theme.theme-dracula', 'not-an-id']},
      },
    });
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    const connectedAt = Date.now();
    const [containerId = ''] = await devContainersOf(folder);
    await waitFor(
      'the extension folder of dracula-theme.theme-dracula',
      async () =>
        (await installedIn(containerId)).some(entry =>
          entry.startsWith(DRACULA_PREFIX),
        ),
      INSTALL_MILLISECONDS,
    );
    console.log(
      `containers-16 row 12: the window was connected ${String(Date.now() - connectedAt)} ms before the extension folder existed`,
    );
    const installed = await installedIn(containerId);
    const notices = await notificationCentre(name);
    await closeWindow(name);
    deepStrictEqual(
      [
        installed.filter(entry => entry.startsWith(DRACULA_PREFIX)).length,
        notices,
      ],
      [1, []],
    );
  });
});
