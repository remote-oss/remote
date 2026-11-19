/**
 * @fileoverview A connect to a host that has neither curl nor wget on its login PATH, with the local download off (card
 * #2854, F-2402 part 1). The account `harness-nofetch` (alias `nofetch`) has a login PATH of its own, `/opt/nofetch/bin`,
 * which holds every program of the host but those two; a copy of curl lies in `/opt/fetch-off`, on no account's PATH.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
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
  variable,
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

  it('F-2402 AC-1, AC-7, AC-28 (c2854-dialog): with neither curl nor wget on the login PATH, and a copy of curl outside it, the dialog gives the reason of STR:S042, ending in exactly one period, with the three buttons', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-dialog';
      appendScript(dismissals(name));
      await failedOn(ALIAS, name);
      try {
        const dialog = recordLines('failureDialog', name)[0];
        deepStrictEqual(
          {
            question: dialog?.question,
            buttons: dialog?.buttons,
            curlOutsidePath: await onHost('ls', '/opt/fetch-off/curl'),
          },
          {
            curlOutsidePath: '/opt/fetch-off/curl\n',
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

  it('F-2402 AC-26 (c2854-nothing-installed): on a server folder emptied beforehand, that failure leaves it empty: no install folder, no lock and no file in it', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-nothing-installed';
      // freshHost clears only bin and cli, so the rest of the folder is cleared here: the row does not depend on its neighbours.
      await onHostAs(
        ACCOUNT,
        'sh',
        '-c',
        `rm -rf '${DATA}'/* '${DATA}'/.[!.]*`,
      );
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
        // The first attempt's dialog is held until the signal, so curl is in place before Retry.
        await waitFor(
          'the first dialog',
          () => recordLines('failureDialog', name).length > 0,
          120_000,
        );
        await onHostAs(
          ACCOUNT,
          'ln',
          '-s',
          '/opt/fetch-off/curl',
          '/opt/nofetch/bin/curl',
        );
        signal('c2854-curl');
        await connectedWithin(name, 300_000, ACCOUNT);
        // The record holds two lines of this dialog (measured, run 44486613703), so the row counts what the lines say, not their number.
        const questions = recordLines('failureDialog', name).map(
          line => line.question,
        );
        deepStrictEqual(
          [questions.length > 0, new Set(questions).size],
          [true, 1],
          JSON.stringify(questions),
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

  /** The number of requests the download host has logged so far. */
  function requestsLogged(): number {
    return readFileSync(variable('HARNESS_DOWNLOADS_LOG'), 'utf8')
      .split('\n')
      .filter(line => line !== '').length;
  }

  /**
   * Connects window `name` in legacy mode with `mode` as the local download (the server is copied from the client, as the
   * host has no downloader), reloads it with `reloadMode`, and tells what the reload showed and whether it downloaded.
   */
  async function reloaded(
    name: string,
    mode: string,
    reloadMode: string,
  ): Promise<{dialogs: string[]; requests: number}> {
    let shown = {dialogs: [] as string[], requests: -1};
    await withSettings(
      {
        'remote.SSH.localServerDownload': mode,
        'remote.SSH.useExecServer': false,
      },
      async () => {
        appendScript(dismissals(name));
        await openWindow(ALIAS, name, ACCOUNT);
        try {
          await connectedWithin(name, INSTALL_MILLISECONDS, ACCOUNT);
          await userSettings({'remote.SSH.localServerDownload': reloadMode});
          const before = requestsLogged();
          await reloadWindow(name);
          await connectedWithin(name, INSTALL_MILLISECONDS, ACCOUNT);
          shown = {
            dialogs: recordLines('failureDialog', name).map(
              line => line.question,
            ),
            requests: requestsLogged() - before,
          };
        } finally {
          await closeWindow(name).catch(() => undefined);
        }
      },
    );
    return shown;
  }

  it('F-2402 AC-10 (c2854-legacy-off): a legacy server installed and running on a host with no downloader, "off" and a reload: the window connects to it, with no dialog and nothing downloaded', async () => {
    deepStrictEqual(await reloaded('c2854-legacy-off', 'auto', 'off'), {
      dialogs: [],
      requests: 0,
    });
  });

  it('F-2402 AC-17 (c2854-legacy-reload): the same with "auto": the reload connects, with no dialog and no download', async () => {
    deepStrictEqual(await reloaded('c2854-legacy-reload', 'auto', 'auto'), {
      dialogs: [],
      requests: 0,
    });
  });

  it('F-2402 AC-18 (c2854-legacy-always): the same with "always": the reload connects, with no dialog and no download', async () => {
    deepStrictEqual(await reloaded('c2854-legacy-always', 'always', 'always'), {
      dialogs: [],
      requests: 0,
    });
  });

  it('F-2402 AC-19 (c2854-legacy-stopped): a legacy server installed but not running, "off" and no downloader: the window connects, with no dialog', async () => {
    await withSettings(
      {
        'remote.SSH.localServerDownload': 'auto',
        'remote.SSH.useExecServer': false,
      },
      async () => {
        const name = 'c2854-legacy-stopped';
        appendScript(dismissals(name));
        await openWindow(ALIAS, name, ACCOUNT);
        await connectedWithin(name, INSTALL_MILLISECONDS, ACCOUNT);
        await closeWindow(name);
        await onHostAs(
          ACCOUNT,
          'pkill',
          '-f',
          `${DATA_FOLDER.replace('/harness/', `/${ACCOUNT}/`).replace('/.', '/[.]')}/bin/`,
        ).catch(() => undefined);
        await userSettings({'remote.SSH.localServerDownload': 'off'});
        const again = 'c2854-legacy-stopped-again';
        appendScript(dismissals(again));
        await openWindow(ALIAS, again, ACCOUNT);
        try {
          await connectedWithin(again, INSTALL_MILLISECONDS, ACCOUNT);
          deepStrictEqual(
            recordLines('failureDialog', again).map(line => line.question),
            [],
          );
        } finally {
          await closeWindow(again).catch(() => undefined);
        }
      },
    );
  });

  it('F-2402 AC-8 (c2854-curl-only): a host with only curl, with the default settings: the window connects without any text of this feature, the host having downloaded the server itself', async () => {
    await withSettings(
      {'remote.SSH.localServerDownload': undefined},
      async () => {
        const name = 'c2854-curl-only';
        appendScript(dismissals(name));
        await onHostAs(
          ACCOUNT,
          'ln',
          '-s',
          '/opt/fetch-off/curl',
          '/opt/nofetch/bin/curl',
        );
        try {
          await openWindow(ALIAS, name, ACCOUNT);
          await connectedWithin(name, INSTALL_MILLISECONDS, ACCOUNT);
          const stages = recordLines('progress', name).map(line =>
            String(line.details ?? ''),
          );
          deepStrictEqual(
            [
              recordLines('failureDialog', name).length,
              stages.some(stage => stage.includes('Copying VS Code Server')),
              stages.some(stage =>
                stage.includes('Downloading VS Code Server locally'),
              ),
            ],
            [0, false, false],
            JSON.stringify(stages),
          );
        } finally {
          await onHostAs(ACCOUNT, 'rm', '-f', '/opt/nofetch/bin/curl');
          await closeWindow(name).catch(() => undefined);
        }
      },
    );
  });

  it('F-2402 AC-13 (c2854-more-actions): More Actions... opens the pick of actions with its placeholder and no item about curl or wget', async () => {
    await withSettings({}, async () => {
      const name = 'c2854-more-actions';
      appendScript([
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: {button: 'More Actions...'},
          window: name,
        },
        {
          surface: 'mitigationPick',
          match: 'Pick an action',
          answer: 'dismiss',
          window: name,
        },
      ]);
      await openWindow(ALIAS, name);
      try {
        await waitFor(
          'the pick of actions',
          () => recordLines('mitigationPick', name).length > 0,
          120_000,
        );
        const pick = recordLines('mitigationPick', name)[0];
        deepStrictEqual(
          [
            pick?.question,
            (pick?.items ?? []).filter(item => /curl|wget/iu.test(item)),
          ],
          ['Pick an action to help resolve the problem.', []],
          JSON.stringify(pick),
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });
});
