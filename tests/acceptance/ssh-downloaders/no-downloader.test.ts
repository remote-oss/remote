/**
 * @fileoverview A connect to a host that has neither curl nor wget on its login PATH, with the local download off (card
 * #2854, F-2402 part 1). The account `harness-nofetch` (alias `nofetch`) has a login PATH of its own, `/opt/nofetch/bin`,
 * which holds every program of the host but those two; a copy of curl lies in `/opt/fetch-off`, on no account's PATH.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  inWindow,
  onHost,
  onHostAs,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  signal,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
  freshHost,
} from '../windows/maintenance.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';
import {
  failedOn,
  firstRowOf,
  wholeTableOf,
} from '../windows/troubleshooting-support.ts';

const ACCOUNT = 'harness-nofetch';
const ALIAS = 'nofetch';

/** STR:S042, the reason of the dialog and the details of the hint, with its one final period. */
const NO_DOWNLOADER =
  'Downloading VS Code Server failed - please install either curl or wget on the remote.';

/** STR:S159, the message of the hint, with the two spaces before its last sentence. */
const MESSAGE =
  'When first establishing a connection to the remote server, various resources must be installed from the internet. A program (either "wget" or "curl") is used to download these resources, but they are not installed on the remote server.  When this step fails, the extension attempts to use the local machine to download the resources and then upload them to the remote server.';

/** The five mitigations of the hint, in order: STR:S083 for `wget` and for `curl`, S052, S055 and S050. */
const MITIGATIONS = [
  "Install 'wget' on the remote server. Installation steps will vary per distribution.",
  "Install 'curl' on the remote server. Installation steps will vary per distribution.",
  "Ensure curl/wget are on the remote system's 'PATH'",
  'Ensure that the remote server has internet access and that the network is not blocking the download',
  'Enable remote.SSH.localServerDownload to allow VS Code to download the required resources via your local machine and then upload them to the remote server',
];

/** `text` with every space and bullet taken out, which the table's wrapping and list marks leave unlike the strings. */
function compact(text: string): string {
  return text.replaceAll(/[\s•]/gu, '');
}

/** The data folder of the server of the account `harness-nofetch`. */
const DATA = DATA_FOLDER.replace('/harness/', `/${ACCOUNT}/`);

/** Pauses for `milliseconds`. */
function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('a host with no downloader on its login PATH (card #2854, F-2402)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({
      'terminal.integrated.tabs.hideCondition': 'never',
      'terminal.integrated.fontSize': 6,
    });
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  /** Runs `body` with the settings of the rows: the local download off, the platform of the host stored. */
  function withSettings(
    extra: Readonly<Record<string, unknown>>,
    body: () => Promise<void>,
  ): Promise<void> {
    return keepingSettings(async () => {
      await freshHost(ACCOUNT);
      await userSettings({
        'remote.SSH.remotePlatform': {[ALIAS]: 'linux'},
        'remote.SSH.localServerDownload': 'off',
        ...extra,
      });
      await body();
    });
  }

  it('F-2402 AC-1, AC-2, AC-3, AC-7, AC-26, AC-28 (c2854-none): with neither curl nor wget on the login PATH, and a copy of curl outside it, the dialog gives the reason of STR:S042, the troubleshooting row the message and the five mitigations, and the host has only an empty server folder', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-none';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const dialog = recordLines('failureDialog', name)[0];
        const table = await wholeTableOf(name);
        const [status, message, mitigations] = firstRowOf(table);
        deepStrictEqual(
          {
            question: dialog?.question,
            buttons: dialog?.buttons,
            status,
            message: compact(message ?? ''),
            mitigations: compact(mitigations ?? ''),
            curlOutsidePath: await onHost('ls', '/opt/fetch-off/curl'),
            serverFolder: (await onHostAs(ACCOUNT, 'ls', '-A', DATA)).trim(),
          },
          {
            question: `Could not establish connection to "${ALIAS}": ${NO_DOWNLOADER}`,
            buttons: ['Retry', 'More Actions...', 'Close Remote'],
            status: 'NoDownloaderAvailable',
            message: compact(`${MESSAGE} (${NO_DOWNLOADER})`),
            mitigations: compact(MITIGATIONS.join('')),
            curlOutsidePath: '/opt/fetch-off/curl\n',
            serverFolder: '',
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2402 AC-5, AC-24 (c2854-again): Retry and Reload Window each bring the same dialog back while the host is unchanged', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-again';
      appendScript([
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: {button: 'Retry'},
          window: name,
        },
        ...dismissals(name),
      ]);
      await failedOn(ALIAS, name);
      try {
        await waitFor(
          'the dialog after Retry',
          () => recordLines('failureDialog', name).length >= 2,
          120_000,
        );
        await inWindow(name, 'workbench.action.reloadWindow');
        await waitFor(
          'the dialog after Reload Window',
          () => recordLines('failureDialog', name).length >= 3,
          120_000,
        );
        deepStrictEqual(
          [
            ...new Set(
              recordLines('failureDialog', name).map(line => line.question),
            ),
          ],
          [`Could not establish connection to "${ALIAS}": ${NO_DOWNLOADER}`],
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2402 AC-25 (c2854-curl-back): after curl is put on the login PATH, Retry connects the window', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-curl-back';
      appendScript([
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: {button: 'Retry'},
          window: name,
          after: 'c2854-curl',
        },
        ...dismissals(name),
      ]);
      await openWindow(ALIAS, name);
      try {
        // The first attempt fails within seconds; its dialog is held until the signal, so curl is in place before Retry.
        await pause(20_000);
        await onHostAs(
          ACCOUNT,
          'ln',
          '-s',
          '/opt/fetch-off/curl',
          '/opt/nofetch/bin/curl',
        );
        signal('c2854-curl');
        await connectedWithin(name, 300_000, ACCOUNT);
        deepStrictEqual(recordLines('failureDialog', name).length, 1);
      } finally {
        await onHostAs(ACCOUNT, 'rm', '-f', '/opt/nofetch/bin/curl');
        await closeWindow(name).catch(() => undefined);
      }
    });
  });
});
