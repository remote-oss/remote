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

/**
 * What window `name` recorded and the launch's connection log held since its shared connection was ended at `endedAt`
 * (a time in milliseconds), with the log's length at that time as `mark`, and what the window shows now: where a wait
 * for core's dialog stopped.
 */
async function reconnectionState(
  name: string,
  mark: number,
  endedAt: number,
): Promise<string> {
  const recorded = recordLines(undefined, name)
    .filter(line => line.time >= endedAt)
    .map(
      line =>
        `[+${((line.time - endedAt) / 1000).toFixed(1)} s] ${line.surface}: ${line.question} (${line.answer})`,
    );
  const indicator = await statusBarText(name, 'status.host').catch(
    (caught: unknown) => `(unreadable: ${String(caught)})`,
  );
  const shown = await dialogOf(name).catch(() => undefined);
  return [
    `what ${name} recorded since the shared connection ended:`,
    ...recorded,
    `the indicator: ${indicator}`,
    `the dialog now: ${shown === undefined ? 'none' : `${shown.message} / ${shown.details}`}`,
    `the notifications now: ${JSON.stringify(await notifications(name).catch(() => []))}`,
    'the last lines of the connection log since then:',
    ...connectionLog()
      .slice(mark)
      .filter(line => !line.startsWith('Searched for ssh in:'))
      .slice(-60),
  ].join('\n');
}

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
    const timeline: string[] = [];
    let polling = true;
    const poller = (async () => {
      let last = '';
      while (polling) {
        const shown = await dialogOf(name).catch(() => undefined);
        const text = shown === undefined ? 'none' : shown.details;
        if (text !== last) {
          timeline.push(
            `[+${((Date.now() - endedAt) / 1000).toFixed(2)} s] ${text}`,
          );
          last = text;
        }
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    })();
    await inWindow(name, 'opensshremotes.cleanLocalServer');
    const dialog = await waitForDialog(name, 60_000).catch(
      async (caught: unknown) => {
        polling = false;
        await poller;
        throw new Error(
          `${String(caught)}\nTIMELINE of the dialog every 40 ms:\n${timeline.join('\n')}\n${await reconnectionState(name, mark, endedAt)}`,
          {cause: caught},
        );
      },
    );
    polling = false;
    await poller;
    console.log(
      `PROBE ${name} TIMELINE:\n${timeline.join('\n')}\nPROBE ${name} dialog after ${String(Date.now() - endedAt)} ms\n${await reconnectionState(name, mark, endedAt)}`,
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

  it('F-2505 AC-12 (c2663-tw1): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw1', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw1').catch(() => undefined);
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

  it('F-2505 AC-12 (c2663-tw2): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw2', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw2').catch(() => undefined);
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

  it('F-2505 AC-12 (c2663-tw3): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw3', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw3').catch(() => undefined);
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

  it('F-2505 AC-12 (c2663-tw4): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw4', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw4').catch(() => undefined);
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

  it('F-2505 AC-12 (c2663-tw5): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw5', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw5').catch(() => undefined);
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

  it('F-2505 AC-12 (c2663-tw6): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw6', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw6').catch(() => undefined);
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

  it('F-2505 AC-12 (c2663-tw7): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw7', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw7').catch(() => undefined);
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

  it('F-2505 AC-12 (c2663-tw8): the third wrong password at the reconnection’s input makes core show Cannot reconnect at once, with no further attempt', async () => {
    const wrong = {text: 'not-the-password'};
    const result = await reconnectionAnswered('c2663-tw8', [
      wrong,
      wrong,
      wrong,
    ]);
    await closeWindow('c2663-tw8').catch(() => undefined);
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
