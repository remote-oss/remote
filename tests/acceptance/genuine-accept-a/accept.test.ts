import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  editorProduct,
  relaunch,
  reloadWindow,
  reopenInContainer,
  reopenStarted,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {answerDialog, dialogOf, waitForDialog} from '../windows/renderer.ts';
import {
  licenceTexts,
  volumeCommits,
} from '../genuine-containers/licence-support.ts';

/** How long a connect that downloads the server takes to reach its question and to finish, in milliseconds. */
const DIALOG_MILLISECONDS = 300_000;
const CONNECT_MILLISECONDS = 900_000;

describe('the server licence accepted on genuine VS Code, profile A (card containers-129, F-1402)', function () {
  this.timeout(1_800_000);

  it('F-1402 AC-3, AC-5 (accept-a): Accept and Continue lets the connect finish with the server of the client’s commit in the shared volume, and the same profile is asked nothing after a reload, for another container or after the editor restarts', async () => {
    const first = devContainerFolder('c129-accept-one', {name: 'Accept One'});
    const secondFolder = devContainerFolder('c129-accept-two', {
      name: 'Accept Two',
    });
    const name = await openFolderWindow(first);
    const other = await openFolderWindow(secondFolder);
    try {
      await reopenStarted(name);
      const asked = await waitForDialog(name, DIALOG_MILLISECONDS);
      await answerDialog(name, 'Accept and Continue');
      await connectedToContainer(name, CONNECT_MILLISECONDS);
      const connected = {
        asked: [asked.message, asked.details],
        remoteName: (await windowState(name)).remoteName,
        inVolume: (await volumeCommits()).some(
          each => path.basename(each) === editorProduct().commit,
        ),
      };
      // A modal would hold a connect until it is answered, so each connect below that ends with no answer asked nothing.
      await reloadWindow(name);
      await connectedToContainer(name, CONNECT_MILLISECONDS);
      await reopenInContainer(other, CONNECT_MILLISECONDS);
      const second = [
        (await windowState(other)).remoteName,
        await dialogOf(other),
        (await devContainersOf(secondFolder)).length,
      ];
      await closeWindow(other);
      await relaunch(name, {environment: {}});
      await connectedToContainer(name, CONNECT_MILLISECONDS);
      const texts = licenceTexts();
      deepStrictEqual(
        {
          connected,
          second,
          after: [(await windowState(name)).remoteName, await dialogOf(name)],
        },
        {
          connected: {
            asked: [texts.message, texts.details],
            remoteName: 'dev-container',
            inVolume: true,
          },
          second: ['dev-container', undefined, 1],
          after: ['dev-container', undefined],
        },
      );
    } finally {
      await closeWindow(other).catch(() => undefined);
      await closeWindow(name).catch(() => undefined);
      await removeContainers(first);
      await removeContainers(secondFolder);
    }
  });
});
