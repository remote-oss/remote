import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import {
  closeWindow,
  containersLog,
  devContainerFolder,
  inWindow,
  recentlyOpenedIn,
  reopenInContainer,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  chooseQuickPickRow,
  primaryButtonOf,
  quickPickRows,
  statusItem,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';

/** The dialog of a setup that fails, as F-0410 words it, and its buttons sorted. */
const SETUP_FAILED = {
  message: '',
  details: 'An error occurred setting up the container.',
  buttons: ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
};

describe('F-0502 a stored entry whose folder is gone (card containers-43)', function () {
  this.timeout(600_000);

  it('F-0502 AC-23 (ruling-1053-folder): picking a stored dev-container entry whose host folder was deleted shows the remembered title and indicator, the setup error with Retry primary, More Actions... with its four items, and the same error again after Retry and after Reload Window, with the folder named in the log', async () => {
    const folder = devContainerFolder('c43-recent', {name: 'C43 Recent'});
    const starter = await openFolderWindow(
      devContainerFolder('c43-recent-starter'),
    );
    const window = 'c43-recent';
    try {
      const connected = await openFolderWindow(folder);
      await reopenInContainer(connected);
      await closeWindow(connected);
      const entry = (await recentlyOpenedIn(starter)).find(
        each =>
          each.remoteAuthority?.startsWith('dev-container+') === true &&
          each.uri.endsWith('/workspaces/c43-recent'),
      );
      rmSync(folder, {recursive: true, force: true});
      const mark = containersLog().length;
      void inWindow(starter, 'acceptance.agent.openWindow', entry?.uri ?? '');
      const dialog = await waitForDialog(window, 180_000);
      const shown = {
        title: await windowTitle(window),
        indicator: (await statusItem(window, 'status.host')).text,
        dialog: {
          message: dialog.message,
          details: dialog.details,
          buttons: [...dialog.buttons].sort(),
        },
        primary: await primaryButtonOf(window),
      };
      await answerDialog(window, 'More Actions...');
      await waitForQuickPick(window, 30_000);
      const pick = (await quickPickRows(window)).map(entry => entry.label);
      await chooseQuickPickRow(window, 'Reload Window');
      const afterReload = (await waitForDialog(window, 180_000)).details;
      await answerDialog(window, 'Retry');
      const afterRetry = (await waitForDialog(window, 180_000)).details;
      deepStrictEqual(
        {
          shown,
          pick,
          again: [afterRetry, afterReload],
          logged:
            containersLog()
              .slice(mark)
              .filter(line => line.includes("doesn't exist")).length > 0,
        },
        {
          shown: {
            title: '[c43-recent [Dev Container: C43 Recent]]',
            indicator: 'Opening Remote...',
            dialog: SETUP_FAILED,
            primary: 'Retry',
          },
          pick: [
            'Reload Window',
            'Edit devcontainer.json Locally',
            'Open Recent...',
            'Open Documentation',
          ],
          again: [SETUP_FAILED.details, SETUP_FAILED.details],
          logged: true,
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await closeWindow(starter).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
