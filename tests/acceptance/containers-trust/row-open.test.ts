import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  clickButton,
  dialogText,
  pageText,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  chosen,
  docker,
  iconReaches,
  stateOf,
  viewed,
} from '../windows/dev-containers-view.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

/** The body the extension gives core's trust dialog, STR:S265. */
const S265 =
  'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.';

/** The modal that says the local folder is not trusted, and its detail, STR:S360 and STR:S377. */
const S360 = 'The local folder is currently not trusted.';
const S377 =
  'Trust is required to build a dev container from it. The folder will now reopen locally.';

const NEW_WINDOW = 'Open in Container in New Window';

/**
 * A folder with a dev container configuration whose container exists and is stopped, and which the profile does not
 * trust: it was trusted to build the container, and then its trust was taken back.
 */
async function untrusted(
  base: string,
): Promise<{folder: string; container: string}> {
  const folder = devContainerFolder(base, {
    name: `Open ${base}`,
    shutdownAction: 'none',
  });
  const window = await openFolderWindow(folder);
  const reopened = reopenInContainer(window);
  await waitForDialog(window);
  await answerDialog(window, 'Trust Folder & Continue');
  await reopened;
  const [container = ''] = await devContainersOf(folder);
  await inWindow(window, 'workbench.trust.manage');
  await waitFor(
    'the trust editor of the connected window',
    async () => (await pageText(window)).includes('You trust this folder'),
    30_000,
  );
  await clickButton(window, "Don't Trust");
  await new Promise(resolve => setTimeout(resolve, 2_000));
  await closeWindow(window);
  await docker('stop', '--time', '0', container);
  return {folder, container};
}

describe('Open in Container from a row, in an untrusted folder (card containers-103)', function () {
  this.timeout(900_000);

  it('F-0902 AC-49 (ruling-1464): Open in Container in New Window on an exited row of an untrusted folder opens a window that is already on the container’s authority with core’s trust modal (the deviation of ruling 1464), the container stays exited while it is open, and Trust Folder & Continue connects the window to the same container', async () => {
    const base = 'ro-trust';
    const {folder, container} = await untrusted(base);
    try {
      await viewed(base);
      await iconReaches('local', base, 'vm');
      await chosen(base, NEW_WINDOW);
      const asked = await waitForDialog(base, 180_000);
      const whileOpen = [
        asked.buttons,
        (await dialogText(base))?.includes(S265),
        await stateOf(container),
        // The resolve asks the question once the window has switched to the container's authority (the card's ruling).
        (await windowState(base)).remoteName,
      ];
      await answerDialog(base, 'Trust Folder & Continue');
      await connectedToContainer(base);
      deepStrictEqual(
        [whileOpen, await devContainersOf(folder), await stateOf(container)],
        [
          [
            ['Manage', 'Cancel', 'Trust Folder & Continue'],
            true,
            'exited',
            'dev-container',
          ],
          [container],
          'running',
        ],
      );
    } finally {
      await closeWindow(base).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0902 AC-50 (trust-declined): Cancel on that trust modal shows S360 with S377 and OK, and afterwards the window stays on the local folder and the container stays exited', async () => {
    const base = 'ro-declined';
    const {folder, container} = await untrusted(base);
    try {
      await viewed(base);
      await iconReaches('local', base, 'vm');
      await chosen(base, NEW_WINDOW);
      await waitForDialog(base, 180_000);
      await answerDialog(base, 'Cancel');
      const declined = await waitForDialog(base, 60_000);
      const detail = await dialogText(base);
      await answerDialog(base, 'OK');
      await waitFor(
        'the window to settle on the local folder',
        async () => (await windowState(base)).remoteName === null,
        60_000,
      );
      await new Promise(resolve => setTimeout(resolve, 3_000));
      deepStrictEqual(
        [
          declined.message,
          detail?.includes(S377),
          declined.buttons,
          (await windowState(base)).folders.map(entry =>
            decodeURIComponent(entry),
          ),
          await stateOf(container),
        ],
        [S360, true, ['OK'], [`file://${folder}`], 'exited'],
      );
    } finally {
      await closeWindow(base).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
