import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  isTrusted,
  openWindow,
  trustSettled,
  windowState,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  pageText,
  waitForDialog,
} from '../windows/renderer.ts';

describe('the answers to core’s trust question in an SSH window (card coverage-80)', function () {
  this.timeout(300_000);

  // F-2308 AC-26's "Cancel" is this refusing answer: core's trust dialog has no cancel (proteus's ruling on #1602).
  it('F-2508 AC-16, F-2308 AC-26 (c80-refuse): refusing trust leaves the window connected, in Restricted Mode, with no dialog left', async () => {
    await openWindow('harness', 'c80-refuse');
    try {
      await waitForDialog('c80-refuse');
      await answerDialog('c80-refuse', "No, I don't trust the authors");
      await connectedWithin('c80-refuse', INSTALL_MILLISECONDS);
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        [
          (await windowState('c80-refuse')).remoteName,
          await isTrusted('c80-refuse'),
          await dialogOf('c80-refuse'),
          (await pageText('c80-refuse')).includes('Restricted Mode'),
        ],
        ['ssh-remote', false, undefined, true],
      );
    } finally {
      await closeWindow('c80-refuse').catch(() => undefined);
    }
  });

  it('F-2508 AC-31 (c80-trust): trusting the folder connects the window with no Restricted Mode left in it', async () => {
    await openWindow('harness', 'c80-trust');
    try {
      await waitForDialog('c80-trust');
      await answerDialog('c80-trust', 'Yes, I trust the authors');
      await connectedWithin('c80-trust', INSTALL_MILLISECONDS);
      const trusted = await trustSettled('c80-trust', true);
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        [
          (await windowState('c80-trust')).remoteName,
          trusted,
          (await pageText('c80-trust')).includes('Restricted Mode'),
        ],
        ['ssh-remote', true, false],
      );
    } finally {
      await closeWindow('c80-trust').catch(() => undefined);
    }
  });
});
