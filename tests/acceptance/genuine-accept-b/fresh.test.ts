import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  reloadWindow,
  reopenStarted,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {answerDialog, dialogOf, waitForDialog} from '../windows/renderer.ts';
import {
  licenceTexts,
  serversIn,
  volumeCommits,
  volumeStamp,
} from '../genuine-containers/licence-support.ts';

const DIALOG_MILLISECONDS = 300_000;
const CONNECT_MILLISECONDS = 900_000;

/** Fails with what to run first when the shared volume holds no server of the client's commit, which profile A leaves. */
async function requireServerInVolume(): Promise<void> {
  const commit = editorProduct().commit;
  if (!(await volumeCommits()).some(each => path.basename(each) === commit)) {
    throw new Error(
      'the vscode volume holds no server of the client: run genuine-accept-a first, in the same run',
    );
  }
}

describe('the server licence on genuine VS Code, profile B meeting the volume of profile A (card containers-129, F-1402)', function () {
  this.timeout(1_800_000);

  before(requireServerInVolume);

  it('F-1402 AC-3, AC-5 (fresh-profile): in a fresh profile whose volume already holds the server the licence is asked again before any server process starts, and Cancel leaves no server process', async () => {
    const folder = devContainerFolder('c129-fresh-cancel', {
      name: 'Fresh Cancel',
    });
    const name = await openFolderWindow(folder);
    try {
      await reopenStarted(name);
      const asked = await waitForDialog(name, DIALOG_MILLISECONDS);
      const whileOpen = await Promise.all(
        (await devContainersOf(folder)).map(serversIn),
      );
      await answerDialog(name, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 5000));
      const after = await Promise.all(
        (await devContainersOf(folder)).map(serversIn),
      );
      const texts = licenceTexts();
      deepStrictEqual(
        [
          [asked.message, asked.details],
          whileOpen.flat(),
          after.flat(),
          (await windowState(name)).remoteName,
        ],
        [[texts.message, texts.details], [], [], 'dev-container'],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-1402 AC-5 (volume-accept): Accept and Continue in profile B connects with the server already in the volume, whose commit folders are left as they were, and the profile is asked nothing after a reload', async () => {
    const folder = devContainerFolder('c129-fresh-accept', {
      name: 'Fresh Accept',
    });
    const name = await openFolderWindow(folder);
    try {
      const stamp = await volumeStamp();
      await reopenStarted(name);
      await waitForDialog(name, DIALOG_MILLISECONDS);
      await answerDialog(name, 'Accept and Continue');
      await connectedToContainer(name, CONNECT_MILLISECONDS);
      await reloadWindow(name);
      await connectedToContainer(name, CONNECT_MILLISECONDS);
      deepStrictEqual(
        [
          (await windowState(name)).remoteName,
          await volumeStamp(),
          await dialogOf(name),
        ],
        ['dev-container', stamp, undefined],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
