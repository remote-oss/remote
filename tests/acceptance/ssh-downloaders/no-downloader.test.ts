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
  onHost,
  onHostAs,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
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
  INSTALL_MILLISECONDS,
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

  it('F-2402 AC-2, AC-3, AC-7 (c2854-hint): with neither curl nor wget on the login PATH, and a copy of curl outside it, the troubleshooting row has the status NoDownloaderAvailable, the message of STR:S159 and the five mitigations in order', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-hint';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const [status, message, mitigations] = firstRowOf(
          await wholeTableOf(name),
        );
        deepStrictEqual(
          {
            status,
            message: compact(message ?? ''),
            mitigations: compact(mitigations ?? ''),
            curlOutsidePath: await onHost('ls', '/opt/fetch-off/curl'),
          },
          {
            status: 'NoDownloaderAvailable',
            message: compact(`${MESSAGE} (${NO_DOWNLOADER})`),
            mitigations: compact(MITIGATIONS.join('')),
            curlOutsidePath: '/opt/fetch-off/curl\n',
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2402 AC-1, AC-28 (c2854-dialog): the dialog of that failure gives the reason of STR:S042, ending in exactly one period, with the three buttons', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-dialog';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const dialog = recordLines('failureDialog', name)[0];
        deepStrictEqual(
          {question: dialog?.question, buttons: dialog?.buttons},
          {
            question: `Could not establish connection to "${ALIAS}": ${NO_DOWNLOADER}`,
            // The order the harness records a failure dialog's buttons in, as every row of this suite has it.
            buttons: ['Close Remote', 'Retry', 'More Actions...'],
          },
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2402 AC-26 (c2854-nothing-installed): after that failure the host has an empty server folder and nothing else was installed', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-nothing-installed';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        deepStrictEqual(
          (await onHostAs(ACCOUNT, 'find', DATA, '-mindepth', '1'))
            .split('\n')
            .filter(line => line !== ''),
          [],
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
        await reloadWindow(name);
        await waitFor(
          'the dialog after Reload Window',
          () => recordLines('failureDialog', name).length >= 3,
          120_000,
        );
        const questions = recordLines('failureDialog', name).map(
          line => line.question,
        );
        deepStrictEqual(
          [questions.length, new Set(questions).size],
          [3, 1],
          `the dialogs of ${name}: ${JSON.stringify(questions)}`,
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
      await openWindow(ALIAS, name, ACCOUNT);
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
        deepStrictEqual(
          recordLines('failureDialog', name).map(line => line.question),
          [`Could not establish connection to "${ALIAS}": ${NO_DOWNLOADER}`],
        );
      } finally {
        await onHostAs(ACCOUNT, 'rm', '-f', '/opt/nofetch/bin/curl');
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  /** Connects window `name` on the host with `extra` settings and tells what it showed: no dialog, and its progress. */
  async function connectedWith(
    name: string,
    extra: Readonly<Record<string, unknown>>,
  ): Promise<{dialogs: string[]; progress: string[]}> {
    let shown = {dialogs: [] as string[], progress: [] as string[]};
    await withSettings(extra, async () => {
      appendScript(dismissals(name));
      await openWindow(ALIAS, name, ACCOUNT);
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS, ACCOUNT);
        shown = {
          dialogs: recordLines('failureDialog', name).map(
            line => line.question,
          ),
          progress: [
            ...new Set(
              recordLines('progress', name).map(
                line => `${line.question} / ${String(line.details ?? '')}`,
              ),
            ),
          ],
        };
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
    return shown;
  }

  it('F-2402 AC-6 (c2854-auto): with the default "auto" the server is copied from the client with scp, the window connects and no text of this feature appears', async () => {
    const shown = await connectedWith('c2854-auto', {
      'remote.SSH.localServerDownload': 'auto',
    });
    deepStrictEqual(
      [
        shown.dialogs,
        shown.progress.some(line =>
          line.includes('Copying VS Code Server to host with scp'),
        ),
      ],
      [[], true],
      JSON.stringify(shown),
    );
  });

  it('F-2402 AC-16 (c2854-legacy-auto): in legacy mode with "auto" the progress shows the local download, and the window connects with no text of this feature', async () => {
    const shown = await connectedWith('c2854-legacy-auto', {
      'remote.SSH.localServerDownload': 'auto',
      'remote.SSH.useExecServer': false,
    });
    deepStrictEqual(
      [
        shown.dialogs,
        shown.progress.some(line =>
          line.includes('Downloading VS Code Server locally'),
        ),
      ],
      [[], true],
      JSON.stringify(shown),
    );
  });

  it('F-2402 AC-20 (c2854-always): with "always" and no downloader on the host the window connects with no text of this feature', async () => {
    const shown = await connectedWith('c2854-always', {
      'remote.SSH.localServerDownload': 'always',
    });
    deepStrictEqual(shown.dialogs, [], JSON.stringify(shown));
  });
});
