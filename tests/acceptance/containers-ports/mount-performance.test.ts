import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  closeWindow,
  commandsOf,
  inWindow,
  nextEmptyWindow,
  startInWindow,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  notificationCentre,
  rememberPage,
  toggleRow,
  waitForDialog,
  viewRows,
} from '../windows/renderer.ts';
import {
  browserOpens,
  folderOf,
  portsWindows,
  recordBrowserOpens,
} from './ports-support.ts';

/** The command of the information about mount performance. */
const COMMAND = 'remote-containers.openInformationAboutMountPerformance';

/** The page it opens: the extension's own README, at the section on mount performance. */
const PAGE =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md#mount-performance-and-container-volumes';

/** The editor's question before it opens an address on a site it does not trust yet. */
const EXTERNAL_SITE =
  'Do you want VSCodium - Insiders to open the external website?';

/** The command is missing, as core words it. */
const NOT_FOUND = `command '${COMMAND}' not found`;

describe('the information about mount performance (card containers-156)', function () {
  this.timeout(900_000);
  const {connectedWith} = portsWindows();

  before(() => rememberPage('local'));

  it('F-0708 AC-4, AC-6, AC-7, AC-8 (c156-command): in a window before the Dev Containers view has loaded the command is missing and core says so; once the view has loaded it is registered and opens the one page with no other effect', async () => {
    const opens = recordBrowserOpens();
    const window = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    await rememberPage(window);
    try {
      const before = (await commandsOf(window, COMMAND)).includes(COMMAND);
      const refusal = await inWindow(window, COMMAND).then(
        () => 'ran',
        (caught: unknown) =>
          caught instanceof Error ? caught.message : String(caught),
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      const warnings = [refusal].filter(text => text.includes(NOT_FOUND));
      const afterWarning = browserOpens(opens);
      await inWindow(window, 'workbench.view.remote');
      await new Promise(resolve => setTimeout(resolve, 8000));
      const loaded = (await commandsOf(window, COMMAND)).includes(COMMAND);
      const noticesBefore = (await notificationCentre(window)).length;
      const asked: string[] = [];
      async function invoked(): Promise<void> {
        await startInWindow(window, COMMAND);
        const dialog = await waitForDialog(window, 30_000);
        asked.push(dialog.message);
        await answerDialog(window, 'Open');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      await invoked();
      await invoked();
      await waitFor(
        'the page to be opened twice',
        () => Promise.resolve(browserOpens(opens).length >= 2),
        20_000,
      ).catch(() => undefined);
      deepStrictEqual(
        {
          before,
          warnings: warnings.length,
          afterWarning,
          loaded,
          opened: browserOpens(opens),
          asked,
          dialog: await dialogOf(window),
          noticesAdded:
            (await notificationCentre(window)).length - noticesBefore,
        },
        {
          before: false,
          warnings: 1,
          afterWarning: [],
          loaded: true,
          opened: [PAGE, PAGE],
          asked: Array.from({length: 2}, () => EXTERNAL_SITE),
          dialog: undefined,
          noticesAdded: 0,
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0708 AC-1, AC-2 (c156-linux): on a Linux host a connected bind-mounted dev container has no I/O performance row anywhere in its Details section', async () => {
    const window = await connectedWith('c156-hint', {});
    await inWindow(window, 'workbench.view.remote');
    const title = path.basename(folderOf('c156-hint'));
    await new Promise(resolve => setTimeout(resolve, 8000));
    await toggleRow(window, title, 'Attributes');
    const rows = (await viewRows(window, title)) ?? [];
    deepStrictEqual(
      [
        rows.length > 0,
        rows.some(entry => entry.label === 'Bind mount'),
        rows.filter(entry => entry.label === 'I/O performance'),
      ],
      [true, true, []],
    );
  });
});
