import {deepStrictEqual} from 'node:assert';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {chosen, docker, made, viewed} from '../windows/container-rows.ts';
import {
  closeWindow,
  devContainerFolder,
  isTrusted,
  terminalNames,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogText,
  notifications,
  terminalText,
  waitForDialog,
} from '../windows/renderer.ts';

/** The question core asks before it makes a terminal process in an untrusted folder. */
const TRUST_QUESTION = 'Creating a terminal process requires executing code';

/** The notification core shows when that question is answered with Cancel. */
const NOT_LAUNCHED =
  'The terminal process failed to launch: Cannot launch a terminal process in an untrusted workspace.';

/**
 * Runs `body` over an untrusted window on a folder of the run, in which the Dev Containers view lists a container of the
 * run labelled `base` that prints `output` and goes on, and closes the window and removes what it made after.
 */
async function withLogRow(
  base: string,
  output: string,
  body: (window: string, image: string) => Promise<void>,
): Promise<void> {
  const container = await made(base, ['sh', '-c', `echo ${output}; sleep 600`]);
  const image = await docker('inspect', '-f', '{{.Config.Image}}', container);
  const folder = devContainerFolder(`${base}-window`);
  const window = await openFolderWindow(folder);
  try {
    deepStrictEqual(await isTrusted(window), false);
    await viewed(base, window);
    await body(window, image);
  } finally {
    await closeWindow(window).catch(() => undefined);
    await removeContainers(folder);
  }
}

describe('Show Container Log in an untrusted window (card containers-104)', function () {
  this.timeout(600_000);

  it('F-0902 AC-12 (log-trust): in an untrusted folder core asks first, and after Trust Folder & Continue a terminal titled with the image shows the log, and another click opens another', async () => {
    await withLogRow('rt-log', 'trusted-log', async (window, image) => {
      await chosen('rt-log', 'Show Container Log', window);
      const dialog = await waitForDialog(window, 30_000);
      const said = await dialogText(window);
      await answerDialog(window, 'Trust Folder & Continue');
      await waitFor(
        'the log terminal',
        async () => (await terminalNames(window)).includes(image),
        30_000,
      );
      await waitFor(
        'the log in the terminal',
        async () => (await terminalText(window)).includes('trusted-log'),
        30_000,
      );
      await chosen('rt-log', 'Show Container Log', window);
      await waitFor(
        'the second terminal',
        async () =>
          (await terminalNames(window)).filter(each => each === image)
            .length === 2,
        30_000,
      );
      deepStrictEqual(
        [
          said?.includes(TRUST_QUESTION),
          [...dialog.buttons],
          await isTrusted(window),
        ],
        [true, ['Manage', 'Cancel', 'Trust Folder & Continue'], true],
      );
    });
  });

  it('F-0902 AC-39 (log-cancel): Cancel on that question creates no terminal and core shows its error that the process failed to launch in an untrusted workspace', async () => {
    await withLogRow('rt-log-cancel', 'never-shown', async window => {
      const terminals = (await terminalNames(window)).length;
      await chosen('rt-log-cancel', 'Show Container Log', window);
      await waitForDialog(window, 30_000);
      await answerDialog(window, 'Cancel');
      await waitFor(
        'core’s error',
        async () => (await notifications(window)).includes(NOT_LAUNCHED),
        30_000,
      );
      deepStrictEqual(
        [(await terminalNames(window)).length, await isTrusted(window)],
        [terminals, false],
      );
    });
  });
});
