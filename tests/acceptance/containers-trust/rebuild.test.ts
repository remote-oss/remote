import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  isTrusted,
  runLabelArguments,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  dialogText,
  primaryButtonOf,
  waitForDialog,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The body the extension gives core's trust dialog, STR:S265. */
const S265 =
  'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.';

/** The question core asks above it. */
const QUESTION = 'Do you trust the authors of the files in this folder?';

/** Makes the container the folder's labels name, running, without the extension, and gives its id. */
async function existingContainer(folder: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '--detach',
    ...runLabelArguments(),
    '--label',
    `devcontainer.local_folder=${folder}`,
    '--label',
    `devcontainer.config_file=${path.join(folder, '.devcontainer', 'devcontainer.json')}`,
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sleep',
    '86400',
  ]);
  return stdout.trim().slice(0, 12);
}

describe('F-0405 Rebuild and Reopen in an untrusted folder (card coverage-67)', function () {
  this.timeout(900_000);

  it('F-0405 AC-23 (c67-trust): the trust question comes first with Manage, Cancel and Trust Folder & Continue; Cancel and Manage leave the window restricted and the container as it was, Trust Folder & Continue goes on to the rebuild and connects', async () => {
    const folder = devContainerFolder('c67-trust', {name: 'C67 Trust'});
    const oldId = await existingContainer(folder);
    const window = await openFolderWindow(folder);
    try {
      const untrusted = (await isTrusted(window)) === false;
      const asked: unknown[] = [];
      for (const button of ['Cancel', 'Manage']) {
        const running = inWindow(
          window,
          'remote-containers.rebuildAndReopenInContainer',
        );
        const shown = await waitForDialog(window, 60_000);
        asked.push([
          shown.message,
          (await dialogText(window))?.includes(S265),
          shown.buttons,
          await primaryButtonOf(window),
        ]);
        await answerDialog(window, button);
        await running.catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 3000));
        asked.push([
          button,
          await dialogOf(window),
          (await isTrusted(window)) === false,
          (await windowState(window)).remoteName,
          (await devContainersOf(folder)).includes(oldId),
        ]);
      }
      const again = inWindow(
        window,
        'remote-containers.rebuildAndReopenInContainer',
      );
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Trust Folder & Continue');
      await again.catch(() => undefined);
      await connectedToContainer(window);
      await waitFor(
        'the old container to be replaced',
        async () => !(await devContainersOf(folder)).includes(oldId),
        60_000,
      );
      const after = {
        remoteName: (await windowState(window)).remoteName,
        containers: (await devContainersOf(folder)).length,
      };
      deepStrictEqual(
        {untrusted, asked, after},
        {
          untrusted: true,
          asked: [
            [
              QUESTION,
              true,
              ['Manage', 'Cancel', 'Trust Folder & Continue'],
              'Trust Folder & Continue',
            ],
            ['Cancel', undefined, true, null, true],
            [
              QUESTION,
              true,
              ['Manage', 'Cancel', 'Trust Folder & Continue'],
              'Trust Folder & Continue',
            ],
            ['Manage', undefined, true, null, true],
          ],
          after: {remoteName: 'dev-container', containers: 1},
        },
      );
    } finally {
      await closeWindow(window);
      await removeContainers(folder);
    }
  });
});
