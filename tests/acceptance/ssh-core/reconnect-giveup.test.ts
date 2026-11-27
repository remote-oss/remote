/**
 * @fileoverview A reconnection whose password input ends in a refusal (F-2505 AC-12, card #2663): Escape at the input,
 * or the third wrong password, makes core show "Cannot reconnect. Please reload the window." at once, and the
 * extension makes no further attempt, though `remote.SSH.maxReconnectionAttempts` allows more.
 */

import {deepStrictEqual} from 'node:assert';
import {
  agentLife,
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  hostAnswer,
  hostPassword,
  inWindow,
  openWindow,
  readUserSettings,
  recordLines,
  rendererLines,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {changeTimeline} from '../windows/change-timeline.ts';
import {explainedFailure} from '../windows/connect-failure.ts';
import {
  reconnectionGlance,
  reconnectionState,
  type StateReads,
} from '../windows/reconnection-state.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  pageFocusFacts,
  paletteRun,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';

/** The account of the `password-retry` alias, which asks for its password up to three times. */
const ACCOUNT = 'harness-pwonly';

/**
 * How long a window is given after its connect before the shared connection ends. Core shows "Cannot reconnect" through
 * a listener that is a workbench contribution of the last phase, `LifecyclePhase.Eventually` ([oss]
 * `src/vs/workbench/contrib/remote/browser/remote.contribution.ts`). Nothing in the window shows that phase at the log
 * level the launch runs at, so the row waits a fixed time: the phase came 2.1 s after the window's agent had activated in a
 * trace-level run, and the dialog showed after a 12 s wait. A connection that ends before the phase has no listener for its
 * permanent failure, and core never shows the dialog (card #2753).
 */
const WORKBENCH_SETTLED_MILLISECONDS = 15_000;

/** The line that starts a reconnection attempt of the alias in the log. */
const RECONNECTION =
  /^Resolving ssh-remote\+password-retry, attempt \d+, reconnection/u;

describe('a reconnection that is refused its password (card #2663, F-2505 AC-12)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    // Core's dialog is drawn in the window, where a row can read it.
    await userSettings({
      'window.dialogStyle': 'custom',
      'remote.SSH.maxReconnectionAttempts': 5,
      'remote.SSH.remotePlatform': {'password-retry': 'linux'},
    });
  });

  afterEach(async () => {
    await closeAllButLocal();
  });

  after(() => {
    restoreUserSettings(saved);
  });

  /** Connects window `name` with the right password, ends the shared connection, and answers the reconnection's input with `answers`. */
  async function reconnectionAnswered(
    name: string,
    answers: ReadonlyArray<{text: string} | 'dismiss'>,
  ) {
    appendScript([
      {
        surface: 'maskedInput',
        match: 'Enter password',
        answer: {text: hostPassword()},
        window: name,
      },
      hostAnswer(name, {label: 'password-retry'}),
      ...answers.map(answer => ({
        surface: 'maskedInput' as const,
        match: 'Enter password',
        answer,
        window: name,
      })),
    ]);
    await openWindow('password-retry', name, ACCOUNT);
    await connectedWithin(name, 120_000, ACCOUNT);
    await new Promise(resolve =>
      setTimeout(resolve, WORKBENCH_SETTLED_MILLISECONDS),
    );
    const mark = connectionLog().length;
    const asked = recordLines('maskedInput', name).length;
    const endedAt = Date.now();
    // The window's page is read once before the outage, which the failure's explanation reports.
    const readStarted = Date.now();
    await statusBarText(name, 'status.host');
    const readEnded = Date.now();
    await inWindow(name, 'opensshremotes.cleanLocalServer');
    const outageDone = Date.now();
    // What the window shows of dialogs and notifications over the next seconds, a read every 250 ms, for a red to tell a
    // dialog that was drawn and closed again from one that never was.
    const timeline = changeTimeline(
      async () => {
        const shown = await dialogOf(name).catch(() => undefined);
        const toasts = await notifications(name).catch(() => []);
        return `dialog ${shown === undefined ? 'none' : JSON.stringify(shown.details)}; notifications ${JSON.stringify(toasts)}`;
      },
      endedAt,
      250,
      60_000,
    );
    const reads: StateReads = {
      recorded: () => recordLines(undefined, name),
      indicator: () => statusBarText(name, 'status.host'),
      dialog: () => dialogOf(name),
      notifications: () => notifications(name),
      logLines: () => connectionLog(),
      pageFacts: () => pageFocusFacts(),
      pageRead: () =>
        `the read began ${String(readStarted - endedAt)} ms after the end was noted, took ${String(readEnded - readStarted)} ms, and the outage command took ${String(outageDone - readEnded)} ms`,
      agentLife: () => agentLife(name),
      rendererLines: () => rendererLines(name),
      timeline: () => timeline.lines(),
      probeDialog: async () => {
        await paletteRun(name, 'File: Clear Recently Opened');
        const shown = await waitForDialog(name, 5_000).then(
          each => `showed at once: ${JSON.stringify(each.message)}`,
          () => 'did not show within 5 s',
        );
        // The dialog is core's own confirmation: Cancel leaves the recent list as it is.
        await answerDialog(name, 'Cancel').catch(() => undefined);
        return shown;
      },
    };
    const dialog = await waitForDialog(name, 180_000).catch(
      async (caught: unknown) => {
        await timeline.stop();
        throw await explainedFailure(caught, () =>
          reconnectionState(reads, name, mark, endedAt),
        );
      },
    );
    await timeline.stop();
    // What a window shows when the dialog does come, to set beside the lines of a red.
    console.log(`${name}:\n${await reconnectionGlance(reads, endedAt)}`);
    // Time for an attempt the extension should not make.
    await new Promise(resolve => setTimeout(resolve, 20_000));
    return {
      dialog: {details: dialog.details, buttons: dialog.buttons},
      later: (await dialogOf(name))?.details,
      indicator: await statusBarText(name, 'status.host'),
      attempts: connectionLog()
        .slice(mark)
        .filter(line => RECONNECTION.test(line)).length,
      asked: recordLines('maskedInput', name).length - asked,
    };
  }

  it('F-2505 AC-12 (c2663-escape): Escape at the reconnection’s password input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const result = await reconnectionAnswered('c2663-escape', ['dismiss']);
    await closeWindow('c2663-escape').catch(() => undefined);
    deepStrictEqual(result, {
      dialog: {
        details: 'Cannot reconnect. Please reload the window.',
        buttons: ['Cancel', 'Reload Window'],
      },
      later: 'Cannot reconnect. Please reload the window.',
      indicator: 'Disconnected from SSH: password-retry',
      attempts: 1,
      asked: 1,
    });
  });

  it('F-2505 AC-12 (c2663-third-wrong): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-third-wrong', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-third-wrong').catch(() => undefined);
    deepStrictEqual(result, {
      dialog: {
        details: 'Cannot reconnect. Please reload the window.',
        buttons: ['Cancel', 'Reload Window'],
      },
      later: 'Cannot reconnect. Please reload the window.',
      indicator: 'Disconnected from SSH: password-retry',
      attempts: 1,
      asked: 3,
    });
  });
});
