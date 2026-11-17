/**
 * @fileoverview The reconnection loop of a window whose host stops answering (F-2505, card #2703): when core starts
 * it, how the attempts follow each other, and how the limit and the grace time end it. The host is paused, which stops
 * its packets.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  connectionLog,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
} from '../windows/maintenance.ts';
import {
  attemptsSince,
  between,
  clockNow,
  pauseHost,
  unpauseHost,
} from '../windows/outage.ts';
import {
  answerDialog,
  dialogOf,
  indicatorDisconnects,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';

/** The text of core's dialog that ends a reconnection. */
const GIVEN_UP = 'Cannot reconnect. Please reload the window.';

/** Seconds, to one decimal, from `milliseconds`. */
function seconds(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}

describe('the reconnection loop of a window whose host stops answering (card #2703, F-2505)', function () {
  this.timeout(900_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  beforeEach(async () => {
    await userSettings({'window.dialogStyle': 'custom'});
  });

  afterEach(async () => {
    unpauseHost();
    await closeAllButLocal();
    restoreUserSettings(saved);
  });

  /** Opens window `name` on the harness host and waits until it is connected; gives the log's length then. */
  async function connectedWindow(name: string): Promise<number> {
    await openWindow('harness', name);
    await connectedWithin(name, 120_000);
    return connectionLog().length;
  }

  /** Starts an outage and gives the time it began on the log's clock. */
  function outageBegins(): number {
    const began = clockNow();
    pauseHost();
    return began;
  }

  /** What a window shows once core ended its reconnection: the dialog and the indicator. */
  async function givenUp(name: string) {
    await waitFor(
      'the dialog that ends the reconnection',
      async () => (await dialogOf(name))?.details === GIVEN_UP,
      240_000,
    );
    const dialog = await waitForDialog(name, 10_000);
    await indicatorDisconnects(name);
    return {
      details: dialog.details,
      buttons: [...dialog.buttons],
      indicator: await statusBarText(name, 'status.host'),
    };
  }

  it('F-2505 AC-2 (c2703-start): when the packets stop for about 20 s core shows Reconnecting and the resolver is called again at once as attempt 2', async () => {
    const name = 'c2703-start';
    const mark = await connectedWindow(name);
    const began = outageBegins();
    await waitFor(
      'attempt 2',
      () => attemptsSince(mark, 'harness').length > 0,
      90_000,
    );
    await waitFor(
      'the Reconnecting indicator',
      async () =>
        (await statusBarText(name, 'status.host')) ===
        'Reconnecting to SSH: harness...',
      60_000,
    );
    const [first] = attemptsSince(mark, 'harness');
    const delay = seconds(between(began, first?.startedAt ?? 0));
    deepStrictEqual(
      [first?.number, delay >= 18 && delay <= 23, delay],
      [2, true, delay],
    );
  });

  it('F-2505 AC-5 (c2703-gaps): with no limit the attempts go on past the eighth, and the waits between them are 5, 5, 10, 10, 10, 10, 10 and then 30 s', async () => {
    const name = 'c2703-gaps';
    const mark = await connectedWindow(name);
    outageBegins();
    await waitFor(
      'attempt 11',
      () => attemptsSince(mark, 'harness').length >= 10,
      420_000,
    );
    const attempts = attemptsSince(mark, 'harness');
    const waits = attempts.slice(0, -1).map((attempt, index) => {
      const next = attempts[index + 1];
      return attempt.failedAt === undefined || next === undefined
        ? undefined
        : seconds(between(attempt.failedAt, next.startedAt));
    });
    const expected = [5, 5, 10, 10, 10, 10, 10, 30, 30];
    deepStrictEqual(
      [
        attempts.map(attempt => attempt.number),
        waits.map((wait, index) =>
          wait !== undefined && Math.abs(wait - (expected[index] ?? 0)) <= 2
            ? 'ok'
            : wait,
        ),
        (await dialogOf(name))?.details === GIVEN_UP,
      ],
      [[2, 3, 4, 5, 6, 7, 8, 9, 10, 11], expected.map(() => 'ok'), false],
      `the waits were ${JSON.stringify(waits)}`,
    );
  });

  it('F-2505 AC-13 (c2703-limit-2): with the limit 2 attempts 2 and 3 run, and then core shows Cannot reconnect with Cancel and Reload Window and the indicator reads Disconnected', async () => {
    const name = 'c2703-limit-2';
    await userSettings({'remote.SSH.maxReconnectionAttempts': 2});
    const mark = await connectedWindow(name);
    outageBegins();
    const shown = await givenUp(name);
    deepStrictEqual(
      [attemptsSince(mark, 'harness').map(attempt => attempt.number), shown],
      [
        [2, 3],
        {
          details: GIVEN_UP,
          buttons: ['Cancel', 'Reload Window'],
          indicator: 'Disconnected from SSH: harness',
        },
      ],
    );
    await answerDialog(name, 'Cancel');
  });

  it('F-2505 AC-14 (c2703-limit-0): with the limit 0 exactly one reconnection attempt runs before core gives up', async () => {
    const name = 'c2703-limit-0';
    await userSettings({'remote.SSH.maxReconnectionAttempts': 0});
    const mark = await connectedWindow(name);
    outageBegins();
    const shown = await givenUp(name);
    deepStrictEqual(
      [
        attemptsSince(mark, 'harness').map(attempt => attempt.number),
        shown.details,
      ],
      [[2], GIVEN_UP],
    );
    await answerDialog(name, 'Cancel');
  });

  it('F-2505 AC-17 (c2703-setting): a limit changed in the user settings between two attempts applies at the next failed attempt without a reload', async () => {
    const name = 'c2703-setting';
    await userSettings({'remote.SSH.maxReconnectionAttempts': 8});
    const mark = await connectedWindow(name);
    outageBegins();
    await waitFor(
      'attempt 4 to fail',
      () => attemptsSince(mark, 'harness')[2]?.failedAt !== undefined,
      180_000,
    );
    await userSettings({'remote.SSH.maxReconnectionAttempts': 2});
    const changedAt = clockNow();
    const shown = await givenUp(name);
    deepStrictEqual(
      [
        attemptsSince(mark, 'harness').map(attempt => attempt.number),
        shown.details,
      ],
      [[2, 3, 4, 5], GIVEN_UP],
      `the attempts were ${JSON.stringify(attemptsSince(mark, 'harness').map(attempt => [attempt.number, seconds(between(changedAt, attempt.startedAt)), attempt.failedAt === undefined ? undefined : seconds(between(changedAt, attempt.failedAt))]))} s from the change, which was read back before the dialog`,
    );
    await answerDialog(name, 'Cancel');
  });

  it('F-2505 AC-17 (c2703-folder-setting): a limit in the remote folder’s settings has no effect', async () => {
    const name = 'c2703-folder-setting';
    const folder = `/home/harness/${name}`;
    await onHost('mkdir', '-p', `${folder}/.vscode`);
    await onHost(
      'sh',
      '-c',
      `printf '%s' '{"remote.SSH.maxReconnectionAttempts": 0}' > ${folder}/.vscode/settings.json`,
    );
    const mark = await connectedWindow(name);
    outageBegins();
    await waitFor(
      'attempt 4',
      () => attemptsSince(mark, 'harness').length >= 3,
      180_000,
    );
    deepStrictEqual(
      [
        attemptsSince(mark, 'harness').map(attempt => attempt.number),
        (await dialogOf(name))?.details === GIVEN_UP,
      ],
      [[2, 3, 4], false],
    );
  });

  it('F-2505 AC-16 (c2703-earlier): a window that made more attempts in an earlier outage than the limit now allows stops reconnecting when the next attempt fails', async () => {
    const name = 'c2703-earlier';
    const mark = await connectedWindow(name);
    outageBegins();
    await waitFor(
      'attempt 4 to fail',
      () => attemptsSince(mark, 'harness')[2]?.failedAt !== undefined,
      180_000,
    );
    unpauseHost();
    await waitFor(
      'the window to reconnect',
      async () => (await statusBarText(name, 'status.host')) === 'SSH: harness',
      180_000,
    );
    await userSettings({'remote.SSH.maxReconnectionAttempts': 1});
    const second = connectionLog().length;
    outageBegins();
    const shown = await givenUp(name);
    deepStrictEqual(
      [attemptsSince(second, 'harness').length, shown.details],
      [1, GIVEN_UP],
      `the attempts were ${JSON.stringify(attemptsSince(mark, 'harness').map(attempt => attempt.number))}, those from the second outage on ${JSON.stringify(attemptsSince(second, 'harness').map(attempt => attempt.number))}`,
    );
    await answerDialog(name, 'Cancel');
  });

  for (const [value, label] of [
    [-1, 'minus-one'],
    ['abc', 'text'],
  ] as const) {
    it(`F-2505 AC-18 (c2703-value-${label}): the limit ${JSON.stringify(value)} ${value === -1 ? 'behaves like 0: one attempt, then core gives up' : 'means no limit: the attempts go on past the fourth'}`, async () => {
      const name = `c2703-value-${label}`;
      await userSettings({'remote.SSH.maxReconnectionAttempts': value});
      const mark = await connectedWindow(name);
      outageBegins();
      if (value !== -1) {
        await waitFor(
          'attempt 6',
          () => attemptsSince(mark, 'harness').length >= 5,
          240_000,
        );
      }
      const shown = value === -1 ? await givenUp(name) : undefined;
      deepStrictEqual(
        [
          attemptsSince(mark, 'harness').map(attempt => attempt.number),
          shown?.details,
          (await dialogOf(name))?.details === GIVEN_UP,
        ],
        value === -1
          ? [[2], GIVEN_UP, true]
          : [[2, 3, 4, 5, 6], undefined, false],
      );
    });
  }

  it('F-2505 AC-30 (c2703-reload-0): with the limit 0 a reload of the window on a host that does not answer runs the connect as attempt 1, not stopped by the limit, and Retry of the failure dialog reloads the window', async () => {
    const name = 'c2703-reload-0';
    await userSettings({'remote.SSH.maxReconnectionAttempts': 0});
    await connectedWindow(name);
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window: name,
      },
      ...dismissals(name),
    ]);
    pauseHost();
    const mark = connectionLog().length;
    await reloadWindow(name);
    await waitFor(
      'the failure dialog twice, the second after Retry',
      () => recordLines('failureDialog', name).length >= 2,
      360_000,
    );
    const dialogs = recordLines('failureDialog', name);
    const resolves = connectionLog()
      .slice(mark)
      .filter(line =>
        /^Resolving ssh-remote\+harness, attempt \d+/u.test(line),
      );
    deepStrictEqual(
      [
        dialogs.map(line => [
          line.question.startsWith(
            'Could not establish connection to "harness"',
          ),
          line.answer,
        ]),
        resolves.map(
          line =>
            line.replace(/,.*$/u, '').length > 0 && /attempt 1\b/u.test(line),
        ),
      ],
      [
        [
          [true, 'Retry'],
          [true, 'dismiss'],
        ],
        [true, true],
      ],
      `the resolves were ${JSON.stringify(resolves)}`,
    );
  });

  it('F-2505 AC-20 (c2703-grace): with the grace time 30 core ends the reconnection about 30 to 40 s into the attempts, and Reload Window reconnects once the host answers', async () => {
    const name = 'c2703-grace';
    // The grace time reaches core when the server starts, so the server that earlier rows left is replaced.
    await freshHost();
    await userSettings({
      'remote.SSH.reconnectionGraceTime': 30,
      'window.dialogStyle': 'custom',
    });
    const mark = await connectedWindow(name);
    outageBegins();
    const shown = await givenUp(name);
    const dialogAt = clockNow();
    const [first] = attemptsSince(mark, 'harness');
    // Core ends the reconnection at the first error after the grace time, and an attempt takes about 10 s to fail here.
    const into = seconds(between(first?.startedAt ?? 0, dialogAt));
    unpauseHost();
    await answerDialog(name, 'Reload Window');
    await connectedWithin(name, 180_000);
    deepStrictEqual(
      [shown.details, into >= 30 && into <= 45, into],
      [GIVEN_UP, true, into],
    );
    await freshHost();
  });
});
