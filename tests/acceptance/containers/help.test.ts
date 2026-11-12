import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  closeWindow,
  devContainersOf,
  userSettingsFile,
} from '../windows/harness.ts';
import {bindKeys} from '../windows/explorer-folders.ts';
import {withWindow} from '../windows/authoring-support.ts';
import {connectedWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  notificationCentre,
  paletteRows,
  paletteRun,
  pressControlAlt,
  quickPickOf,
  rememberPage,
} from '../windows/renderer.ts';
import {installBrowser, openedUrls} from '../windows/web-ui-support.ts';

/** What the commands of F-0105 open: our own pages, not the reference's. */
const DOCUMENTATION =
  'https://github.com/remote-oss/remote/tree/main/docs/remote-containers';
const GET_STARTED =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-containers/README.md';
const FEEDBACK = 'https://github.com/remote-oss/remote/issues/new/choose';

/** How long the opener is given to be asked, in milliseconds. */
const OPENER_MILLISECONDS = 30_000;

/** What window `window` shows of its own after a command: notifications, a quick pick and a dialog that is not the editor's link prompt. */
async function shownOfOwn(window: string): Promise<{
  notices: string[];
  pick: unknown;
  dialog: string | undefined;
}> {
  const dialog = await dialogOf(window);
  return {
    notices: await notificationCentre(window),
    pick: await quickPickOf(window),
    dialog: dialog?.message.endsWith('to open the external website?')
      ? undefined
      : dialog?.message,
  };
}

/**
 * Runs `command` from the palette of window `window` and gives the addresses it asked the opener for, answering the
 * editor's own prompt for an address outside its trusted ones when it shows one.
 */
async function opened(window: string, command: string): Promise<string[]> {
  const before = openedUrls().length;
  await paletteRun(window, command);
  const deadline = Date.now() + OPENER_MILLISECONDS;
  while (openedUrls().length === before && Date.now() < deadline) {
    const prompt = await dialogOf(window);
    if (prompt?.message.endsWith('to open the external website?') === true) {
      await answerDialog(window, 'Open');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return openedUrls().slice(before);
}

/** The rows of the palette of window `window` for `text` that are the command `title`. */
async function listed(window: string, title: string): Promise<string[]> {
  return (await paletteRows(window, title)).filter(entry => entry === title);
}

describe('the help commands (card containers-218)', function () {
  this.timeout(900_000);

  before(() => rememberPage('local'));

  it('F-0105 AC-1, AC-2, AC-5, AC-10, AC-25 (c218-local): in a local window Help and Get Started open our pages and nothing else, again the same, and Provide Feedback is not listed', async () => {
    installBrowser();
    await withWindow('c218-local', {}, async window => {
      const first = await opened(window, 'Dev Containers: Help');
      const own = await shownOfOwn(window);
      const again = await opened(window, 'Dev Containers: Help');
      const started = await opened(
        window,
        'Dev Containers: Get Started with Dev Containers',
      );
      deepStrictEqual(
        {
          first,
          again,
          started,
          own,
          feedback: await listed(window, 'Dev Containers: Provide Feedback'),
        },
        {
          first: [DOCUMENTATION],
          again: [DOCUMENTATION],
          started: [GET_STARTED],
          own: {notices: [], pick: undefined, dialog: undefined},
          feedback: [],
        },
      );
    });
  });

  it('F-0105 AC-3, AC-4, AC-12, AC-22, AC-25 (c218-container): in a dev container window Get Started is not listed, Provide Feedback opens our page as the sole match, and Help and Report Issue are listed', async () => {
    installBrowser();
    const {name, folder} = await connectedWindow('c218-container');
    try {
      const feedbackRows = (
        await paletteRows(name, 'Dev Containers: Provide Feedback')
      ).filter(entry => entry.startsWith('Dev Containers: '));
      const feedback = await opened(name, 'Dev Containers: Provide Feedback');
      deepStrictEqual(
        {
          started: await listed(
            name,
            'Dev Containers: Get Started with Dev Containers',
          ),
          feedbackRows,
          feedback,
          help: await listed(name, 'Dev Containers: Help'),
          report: await listed(name, 'Dev Containers: Report Issue...'),
          own: await shownOfOwn(name),
        },
        {
          started: [],
          feedbackRows: ['Dev Containers: Provide Feedback'],
          feedback: [FEEDBACK],
          help: ['Dev Containers: Help'],
          report: ['Dev Containers: Report Issue...'],
          own: {notices: [], pick: undefined, dialog: undefined},
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
  it('F-0105 AC-20 (c218-key-feedback): in a local window a keybinding with no condition on Provide Feedback opens at most our feedback page, makes no container and writes no setting, and the window shows nothing of its own', async () => {
    installBrowser();
    await withWindow('c218-key-feedback', {}, async (window, folder) => {
      const restore = await bindKeys([
        {key: 'ctrl+alt+7', command: 'remote-containers.provideFeedback'},
      ]);
      try {
        const settings = readFileSync(userSettingsFile(), 'utf8');
        const before = openedUrls().length;
        await pressControlAlt(window, '7');
        await new Promise(resolve => setTimeout(resolve, 5000));
        const urls = openedUrls().slice(before);
        deepStrictEqual(
          {
            urls: urls.every(url => url === FEEDBACK) && urls.length <= 1,
            containers: await devContainersOf(folder),
            settings: readFileSync(userSettingsFile(), 'utf8') === settings,
            own: await shownOfOwn(window),
          },
          {
            urls: true,
            containers: [],
            settings: true,
            own: {notices: [], pick: undefined, dialog: undefined},
          },
        );
      } finally {
        restore();
      }
    });
  });

  it('F-0105 AC-23 (c218-key-started): in a dev container window a keybinding with no condition on Get Started opens our page with nothing else, or the editor says the command is not possible here, and the container and the settings are as they were', async () => {
    installBrowser();
    const {name, folder, containerId} =
      await connectedWindow('c218-key-started');
    const restore = await bindKeys([
      {
        key: 'ctrl+alt+8',
        command: 'remote-containers.getStarted',
      },
    ]);
    try {
      const settings = readFileSync(userSettingsFile(), 'utf8');
      await pressControlAlt(name, '8');
      await new Promise(resolve => setTimeout(resolve, 5000));
      const urls = openedUrls();
      const notices = await notificationCentre(name);
      const outcome =
        urls.length === 1 && urls[0] === GET_STARTED && notices.length === 0
          ? 'opened'
          : urls.length === 0 &&
              notices.length === 1 &&
              (notices[0] ?? '').includes(
                'is not possible in the current context',
              )
            ? 'refused'
            : {urls, notices};
      deepStrictEqual(
        {
          outcome: outcome === 'opened' || outcome === 'refused',
          containers: await devContainersOf(folder),
          settings: readFileSync(userSettingsFile(), 'utf8') === settings,
        },
        {
          outcome: true,
          containers: [containerId],
          settings: true,
        },
        JSON.stringify(outcome),
      );
    } finally {
      restore();
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
