/**
 * @fileoverview A reconnection whose password input ends in a refusal (F-2505 AC-12, card #2663): Escape at the input,
 * or the third wrong password, makes core show "Cannot reconnect. Please reload the window." at once, and the
 * extension makes no further attempt, though `remote.SSH.maxReconnectionAttempts` allows more.
 */

import {deepStrictEqual} from 'node:assert';
import {
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
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {explainedFailure} from '../windows/connect-failure.ts';
import {reconnectionState} from '../windows/reconnection-state.ts';
import {
  dialogOf,
  notifications,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';

/** The account of the `password-retry` alias, which asks for its password up to three times. */
const ACCOUNT = 'harness-pwonly';

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
    const mark = connectionLog().length;
    const asked = recordLines('maskedInput', name).length;
    const endedAt = Date.now();
    // The window's page is read once before the outage: core's dialog did not show in a window whose page the harness
    // had not read before the shared connection ended (21 of 24 rows of the third wrong password), and shows in one it had.
    await statusBarText(name, 'status.host');
    await inWindow(name, 'opensshremotes.cleanLocalServer');
    const dialog = await waitForDialog(name, 180_000).catch(
      async (caught: unknown) => {
        throw await explainedFailure(caught, () =>
          reconnectionState(
            {
              recorded: () => recordLines(undefined, name),
              indicator: () => statusBarText(name, 'status.host'),
              dialog: () => dialogOf(name),
              notifications: () => notifications(name),
              logLines: () => connectionLog(),
            },
            name,
            mark,
            endedAt,
          ),
        );
      },
    );
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

  for (const index of Array.from({length: 24}, (each, place) => place + 1)) {
    it(`F-2505 AC-12 (c2663-tw${String(index)}): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt`, async () => {
      const wrong = {text: 'not-the-password'};
      const result = await reconnectionAnswered(`c2663-tw${String(index)}`, [
        wrong,
        wrong,
        wrong,
      ]);
      await closeWindow(`c2663-tw${String(index)}`).catch(() => undefined);
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
  }
});
