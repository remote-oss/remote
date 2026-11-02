import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  signal,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {freshHost, INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {
  answerDialog,
  notifications,
  waitForDialog,
} from '../windows/renderer.ts';

/** The stages of the client's download and of its copy to the host. */
const LOCAL_STAGES = [
  'Downloading VS Code Server locally',
  'Copying VS Code Server to host with scp',
];

/** The host without a stored platform, so that a retry asks for it again (F-2704 AC-21). */
const ALIAS = 'harness-bash';

/** The number of requests the download host has logged so far. */
function requestsLogged(): number {
  return readFileSync(variable('HARNESS_DOWNLOADS_LOG'), 'utf8')
    .split('\n')
    .filter(line => line !== '').length;
}

describe('the local download in an untrusted folder in terminal mode (card coverage-87)', function () {
  this.timeout(300_000);

  let saved: string | undefined;

  beforeEach(async () => {
    saved = readUserSettings();
    // A host with no server of ours needs the download, and the one the host cannot make is the client's.
    await freshHost(ALIAS);
    await userSettings({
      'remote.SSH.serverDownloadUrlTemplate': `${variable('HARNESS_DOWNLOADS_LOCAL')}/ok/\${os}-\${arch}/\${commit}`,
      'remote.SSH.connectTimeout': 10,
    });
  });

  afterEach(() => {
    restoreUserSettings(saved);
  });

  /** The script of a window that picks Linux and, on the dialog of its failure, waits for `retry` and presses Retry. */
  function retryingScript(window: string, retry: string): AppendedEntry[] {
    return [
      {surface: 'platformPick', match: 'platform', answer: 'linux', window},
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window,
        after: retry,
      },
      {surface: 'platformPick', match: 'platform', answer: 'linux', window},
    ];
  }

  it('F-2405 AC-28 (tw28): while the trust dialog is open the notification shows only Initializing VS Code Server, with neither local stage and no request to the download host', async () => {
    const window = 'tw28';
    const start = requestsLogged();
    appendScript(retryingScript(window, 'tw28-retry'));
    await openWindow(ALIAS, window);
    try {
      await waitForDialog(window);
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(
        {
          toasts: await notifications(window),
          stages: recordLines('progress', window)
            .map(line => line.question)
            .filter(text => LOCAL_STAGES.includes(text)),
          requests: requestsLogged() - start,
        },
        {
          toasts: [
            `Setting up SSH Host ${ALIAS}: (details) Initializing VS Code Server`,
          ],
          stages: [],
          requests: 0,
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-2405 AC-18 (tw18): with the trust dialog left open the connect fails with the timed-out detail, and after Trust Folder & Continue and Retry the platform pick is asked again and the window connects with one local download', async () => {
    const window = 'tw18';
    const start = requestsLogged();
    appendScript(retryingScript(window, 'tw18-retry'));
    await openWindow(ALIAS, window);
    try {
      await waitForDialog(window);
      await waitFor(
        'the timeout dialog, held',
        () => recordLines('failureDialog', window).length > 0,
        120_000,
      );
      const timedOut = recordLines('failureDialog', window)[0]?.question;
      await answerDialog(window, 'Trust Folder & Continue');
      signal('tw18-retry');
      await connectedWithin(window, INSTALL_MILLISECONDS);
      deepStrictEqual(
        {
          timedOut,
          picks: recordLines('platformPick', window).length,
          stages: recordLines('progress', window)
            .map(line => line.question)
            .filter(text => LOCAL_STAGES.includes(text)),
          requests: requestsLogged() - start,
        },
        {
          timedOut: `Could not establish connection to "${ALIAS}": Connecting with SSH timed out.`,
          picks: 2,
          stages: LOCAL_STAGES,
          requests: 1,
        },
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
