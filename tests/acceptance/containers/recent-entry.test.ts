import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  devContainerFolder,
  devContainersOf,
  inWindow,
  recentlyOpenedIn,
  reloadWindow,
  reopenInContainer,
  startInWindow,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  chooseQuickPickRow,
  detailedQuickPickRows,
  pressEscape,
  primaryButtonOf,
  quickPickRows,
  statusItem,
  statusItemText,
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

describe('The Open Recent entry and the label of a connected window (cards containers-43 and coverage-74)', function () {
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
  it('F-0504 AC-2 (c74-static-label): the Open Recent list of a connected window has a new entry labelled with the folder name and [Dev Container], whatever the configuration’s name is', async () => {
    const folder = devContainerFolder('c74-static-label', {
      name: 'Name Not In The Label',
    });
    try {
      const window = await openFolderWindow(folder);
      await reopenInContainer(window);
      await startInWindow(window, 'workbench.action.openRecent');
      await waitForQuickPick(window, 30_000);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const rows = await detailedQuickPickRows(window);
      await pressEscape(window);
      await closeWindow(window);
      deepStrictEqual(
        rows.slice(0, 2).map(entry => entry.label),
        ['c74-static-label [Dev Container]', 'c74-static-label'],
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0504 AC-28 (c74-name-change): a changed configuration name shows in the title, the indicator text and its label after a Reload Window, with the same container, not rebuilt', async () => {
    const folder = devContainerFolder('c74-name-change', {name: 'Before'});
    try {
      const window = await openFolderWindow(folder);
      await reopenInContainer(window);
      const [before = ''] = await devContainersOf(folder);
      devContainerFolder('c74-name-change', {name: 'After'});
      await reloadWindow(window);
      const text = await statusItemText(
        window,
        'status.host',
        'Dev Container: After',
        60_000,
      );
      const indicator = await statusItem(window, 'status.host');
      const state = {
        text,
        label: indicator.ariaLabel.endsWith('Dev Container: After'),
        title: await windowTitle(window),
        containers: await devContainersOf(folder),
      };
      await closeWindow(window);
      deepStrictEqual(state, {
        text: 'Dev Container: After',
        label: true,
        title: '[c74-name-change [Dev Container: After]]',
        containers: [before],
      });
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0501 AC-7 (c74-legacy-payload): a dev-container URI whose authority is the hex of the plain host path opens the folder in its dev container', async () => {
    const folder = devContainerFolder('c74-legacy', {name: 'Legacy Payload'});
    const starter = await openFolderWindow(
      devContainerFolder('c74-legacy-starter'),
    );
    try {
      const authority = Buffer.from(folder).toString('hex');
      void inWindow(
        starter,
        'acceptance.agent.openWindow',
        `vscode-remote://dev-container%2B${authority}/workspaces/c74-legacy`,
      );
      await connectedToContainer('c74-legacy');
      // The indicator can still read "Opening Remote..." a moment after the window connects, as on a cold volume.
      const indicator = await statusItemText(
        'c74-legacy',
        'status.host',
        'Dev Container: Legacy Payload',
        60_000,
      );
      const state = {
        title: await windowTitle('c74-legacy'),
        indicator,
        containers: (await devContainersOf(folder)).length,
      };
      await closeWindow('c74-legacy');
      deepStrictEqual(state, {
        title: '[c74-legacy [Dev Container: Legacy Payload]]',
        indicator: 'Dev Container: Legacy Payload',
        containers: 1,
      });
    } finally {
      await closeWindow(starter).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
