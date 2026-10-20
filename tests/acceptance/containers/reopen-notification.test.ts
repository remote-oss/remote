import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  inWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerNotification,
  dialogOf,
  notificationButtons,
  notificationCentre,
  notificationLinks,
} from '../windows/renderer.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';

/** The notification's message as the window shows it, the link as its words (F-0402 S426 with S186). */
const NOTICE =
  'Folder contains a Dev Container configuration file. Reopen folder to develop in a container (learn more).';

/** The start of the notification's message, to find it by. */
const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** The page the link opens: the extension's introduction. */
const INTRODUCTION =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md';

const FOLLOW_UP = "Don't show again for the current folder or for any folder?";

/** How long a folder window may take to show the notification, from its agent's activation. */
const SHOWN_MILLISECONDS = 10_000;

/** Whether window `name` shows the reopen notification within `milliseconds`. */
async function showsNotice(
  name: string,
  milliseconds = SHOWN_MILLISECONDS,
): Promise<boolean> {
  try {
    await waitFor(
      `the reopen notification in window ${name}`,
      async () => {
        try {
          return (await notificationCentre(name)).some(text =>
            text.startsWith(NOTICE_START),
          );
        } catch {
          return false;
        }
      },
      milliseconds,
    );
    return true;
  } catch {
    return false;
  }
}

describe('the reopen notification (card containers-23, F-0402)', function () {
  this.timeout(600_000);

  it('F-0402 AC-1, AC-2 (n1-n2): a folder with a configuration shows the notification with its link and buttons, and Reopen in Container reconnects the window to its container', async () => {
    const folder = devContainerFolder('notice-shown', {name: 'Notice'});
    const name = await openFolderWindow(folder);
    await showsNotice(name);
    const shown = (await notificationCentre(name)).filter(text =>
      text.startsWith(NOTICE_START),
    );
    const links = await notificationLinks(name, NOTICE_START);
    const buttons = await notificationButtons(name, NOTICE_START);
    await answerNotification(name, NOTICE_START, 'Reopen in Container');
    await connectedToContainer(name);
    const state = await windowState(name);
    deepStrictEqual(
      {
        shown,
        links,
        buttons,
        remoteName: state.remoteName,
        inContainer: state.folders.some(entry =>
          decodeURIComponent(entry).endsWith('/workspaces/notice-shown'),
        ),
      },
      {
        shown: [NOTICE],
        links: [{text: 'learn more', href: INTRODUCTION}],
        buttons: ['Reopen in Container', "Don't Show Again..."],
        remoteName: 'dev-container',
        inContainer: true,
      },
    );
    await closeWindow(name);
  });

  it('F-0402 AC-3 (n3): Don’t Show Again... asks for the scope, with Any Folder and Current Folder', async () => {
    const name = await openFolderWindow(
      devContainerFolder('notice-current', {name: 'Notice Current'}),
    );
    await showsNotice(name);
    await answerNotification(name, NOTICE_START, "Don't Show Again...");
    const buttons = await notificationButtons(name, FOLLOW_UP);
    deepStrictEqual(
      [(await notificationCentre(name)).includes(FOLLOW_UP), buttons],
      [true, ['Any Folder', 'Current Folder']],
    );
    await answerNotification(name, FOLLOW_UP, 'Current Folder');
    await closeWindow(name);
  });

  it('F-0402 AC-4 (n4): Current Folder keeps the notification away from that folder only', async () => {
    const current = devContainerFolder('notice-current');
    const again = await openFolderWindow(current);
    const againShown = await showsNotice(again);
    await closeWindow(again);
    const other = await openFolderWindow(devContainerFolder('notice-other'));
    const otherShown = await showsNotice(other);
    await closeWindow(other);
    deepStrictEqual([againShown, otherShown], [false, true]);
  });

  it('F-0402 AC-9, F-0301 AC-6 (n5): a folder with no configuration shows no notification and no error', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'notice-none');
    mkdirSync(folder, {recursive: true});
    const name = await openFolderWindow(folder);
    const shown = await showsNotice(name);
    const dialog = await dialogOf(name);
    const centre = await notificationCentre(name);
    await closeWindow(name);
    deepStrictEqual([shown, dialog, centre], [false, undefined, []]);
  });

  it('F-0402 AC-5, AC-8 (n6): Any Folder keeps it away from every folder, and the reset command brings it back', async () => {
    const first = await openFolderWindow(
      devContainerFolder('notice-any', {name: 'Notice Any'}),
    );
    try {
      await showsNotice(first);
      await answerNotification(first, NOTICE_START, "Don't Show Again...");
      await answerNotification(first, FOLLOW_UP, 'Any Folder');
      const second = await openFolderWindow(
        devContainerFolder('notice-other2'),
      );
      const suppressed = await showsNotice(second);
      await closeWindow(second);
      await inWindow(
        first,
        'remote-containers.showReopenInContainerNotificationReset',
      );
      const third = await openFolderWindow(devContainerFolder('notice-other2'));
      const back = await showsNotice(third);
      await closeWindow(third);
      deepStrictEqual([suppressed, back], [false, true]);
    } finally {
      await inWindow(
        first,
        'remote-containers.showReopenInContainerNotificationReset',
      );
      await closeWindow(first);
    }
  });
});
