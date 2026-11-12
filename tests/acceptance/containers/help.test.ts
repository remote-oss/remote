import {deepStrictEqual} from 'node:assert';
import {closeWindow} from '../windows/harness.ts';
import {withWindow} from '../windows/authoring-support.ts';
import {connectedWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  notificationCentre,
  paletteRows,
  paletteRun,
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
});
