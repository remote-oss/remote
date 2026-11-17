/**
 * @fileoverview The reconnection loop of a window whose host stops answering (F-2505, card #2703): when core starts
 * it, how the attempts follow each other, and how the limit and the grace time end it. The host is paused, which
 * freezes its processes so that nothing answers.
 *
 * Every bound on a time below is the spec's "about" with a stated tolerance, not a measured run. The rows print what
 * they measured in every run, so a drift toward a bound shows in green runs.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  connectionLog,
  editorProduct,
  inWindow,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {hostBlock, writeConfig} from '../windows/config-keywords-support.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
} from '../windows/maintenance.ts';
import {
  attemptsSince,
  between,
  clockNow,
  localSshOfHarness,
  pauseHost,
  running,
  unpauseHost,
} from '../windows/outage.ts';
import {
  answerDialog,
  dialogOf,
  indicatorDisconnects,
  notifications,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';

/** The text of core's dialog that ends a reconnection. */
const GIVEN_UP = 'Cannot reconnect. Please reload the window.';

/** The seconds an "about" of the spec allows either side of its value (card #2703). */
const ABOUT_SECONDS = 2;

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
    const shownAt = clockNow();
    const dialog = await waitForDialog(name, 10_000);
    await indicatorDisconnects(name);
    return {
      shownAt,
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
    console.log(
      `F-2505 AC-2: attempt 2 started ${String(delay)} s after the pause`,
    );
    // Core ends a connection after 20 s without an acknowledgement of its oldest unacknowledged message and without
    // any data received [oss] (src/vs/base/parts/ipc/common/ipc.net.ts: ProtocolConstants.TimeoutTime, checked in
    // `_recvAckCheck`). That message is the first one written after the pause, up to KeepAliveSendTime (5 s) later, or
    // one the other side had not yet acknowledged (AcknowledgeTime, 2 s) before it, and the check re-arms with a 0.5 s
    // floor. So the reconnection starts between 20 - 2 = 18 s and 20 + 5 + 0.5 s after the pause, and the bound adds
    // 1 s for the pause command and the clock of the log.
    deepStrictEqual(
      [first?.number, delay >= 18 && delay <= 26.5, delay],
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
    console.log(
      `F-2505 AC-5: the waits between attempts were ${JSON.stringify(waits)} s`,
    );
    deepStrictEqual(
      [
        attempts.map(attempt => attempt.number),
        waits.map((wait, index) =>
          wait !== undefined &&
          Math.abs(wait - (expected[index] ?? 0)) <= ABOUT_SECONDS
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
      [
        attemptsSince(mark, 'harness').map(attempt => attempt.number),
        {
          details: shown.details,
          buttons: shown.buttons,
          indicator: shown.indicator,
        },
      ],
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

  it('F-2505 AC-17 (c2703-setting-running): a limit changed while an attempt is running applies at that attempt’s failure or from the attempt that starts after the change, and both pass', async () => {
    const name = 'c2703-setting-running';
    await userSettings({'remote.SSH.maxReconnectionAttempts': 6});
    const mark = await connectedWindow(name);
    outageBegins();
    await waitFor(
      'attempt 3 to run',
      () => {
        const attempts = attemptsSince(mark, 'harness');
        return attempts.length >= 2 && attempts[1]?.failedAt === undefined;
      },
      180_000,
    );
    await userSettings({'remote.SSH.maxReconnectionAttempts': 2});
    const shown = await givenUp(name);
    const numbers = attemptsSince(mark, 'harness')
      .map(attempt => attempt.number)
      .join();
    deepStrictEqual(
      [['2,3', '2,3,4'].includes(numbers), shown.details],
      [true, GIVEN_UP],
      `the attempts were ${numbers}`,
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

  /** Ends the connection of window `name` by killing its local ssh, and gives what the window showed in the next seconds. */
  async function killedSsh(name: string) {
    const before = localSshOfHarness();
    for (const each of before) {
      process.kill(each.processId, 'SIGTERM');
    }
    const began = Date.now();
    const toasts = new Set<string>();
    let reconnectedAfter: number | undefined;
    while (Date.now() - began < 8000) {
      for (const text of await notifications(name).catch(() => [])) {
        toasts.add(text);
      }
      if (
        reconnectedAfter === undefined &&
        (await statusBarText(name, 'status.host').catch(() => '')) ===
          'SSH: harness' &&
        localSshOfHarness().some(
          each => !before.some(earlier => earlier.processId === each.processId),
        )
      ) {
        reconnectedAfter = Date.now() - began;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return {before, toasts: [...toasts], reconnectedAfter};
  }

  const SETTING_UP = 'Setting up SSH Host harness';

  it('F-2505 AC-3 (c2703-progress): during a reconnection attempt the progress notification Setting up SSH Host with its details link and Initializing VS Code Server shows, and it is gone when the attempt ends', async () => {
    const name = 'c2703-progress';
    await connectedWindow(name);
    const {toasts} = await killedSsh(name);
    deepStrictEqual(
      [
        toasts.includes(`${SETTING_UP}: (details) Initializing VS Code Server`),
        (await notifications(name)).filter(text => text.startsWith(SETTING_UP)),
      ],
      [true, []],
      `the notifications seen were ${JSON.stringify(toasts)}`,
    );
  });

  /** Kills the local ssh of window `name` under `settings` and checks that the window reconnects within about a second. */
  async function reconnectedAfterKill(
    name: string,
    settings: Readonly<Record<string, unknown>>,
  ) {
    await userSettings(settings);
    await connectedWindow(name);
    const {before, toasts, reconnectedAfter} = await killedSsh(name);
    console.log(
      `F-2505 AC-10: ${name} reconnected ${String(reconnectedAfter)} ms after the kill`,
    );
    deepStrictEqual(
      [
        before.length > 0,
        // "About 1 s": the spec's value and an "about" of 1 s.
        reconnectedAfter !== undefined && reconnectedAfter <= 2000,
        toasts.some(text =>
          // The terminal mode's notification carries the details link, as F-2304 has it.
          new RegExp(
            `^${SETTING_UP}: (\\(details\\) )?Setting up SSH tunnel$`,
            'u',
          ).test(text),
        ),
      ],
      [true, true, true],
      `it reconnected after ${String(reconnectedAfter)} ms, the notifications seen were ${JSON.stringify(toasts)}`,
    );
  }

  it('F-2505 AC-10 (c2703-ssh-killed-default): when the window’s local ssh dies the window reconnects within about 1 s, showing Setting up SSH tunnel briefly', async () => {
    await reconnectedAfterKill('c2703-ssh-killed-default', {});
  });

  it('F-2505 AC-10 (c2703-ssh-killed-limit-0): the same with the limit 0', async () => {
    await reconnectedAfterKill('c2703-ssh-killed-limit-0', {
      'remote.SSH.maxReconnectionAttempts': 0,
    });
  });

  it('F-2505 AC-10 (c2703-ssh-killed-per-window): the same with remote.SSH.useLocalServer false', async () => {
    await reconnectedAfterKill('c2703-ssh-killed-per-window', {
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': {harness: 'linux'},
    });
  });

  /**
   * The process ids on the host of the server's own processes (the server, the remote extension host and the others that
   * run from its folder) and of the shells below them, which are the terminals'.
   */
  async function hostProcesses() {
    async function pids(...pattern: string[]): Promise<number[]> {
      try {
        return (await onHost('pgrep', '-u', 'harness', ...pattern))
          .split('\n')
          .filter(line => line !== '')
          .map(Number);
      } catch {
        return [];
      }
    }
    const folder = `/home/harness/${editorProduct().serverDataFolderName}/bin/`;
    const server = await pids('-f', folder);
    const below = (
      await Promise.all(server.map(parent => pids('-P', String(parent))))
    ).flat();
    return {
      server,
      shells: below.filter(each => !server.includes(each)),
    };
  }

  it('F-2505 AC-4 (c2703-new-ssh): a reconnection uses a new local ssh and a new forwarding port, and the server, the remote extension host and the terminal’s shell keep their process ids', async () => {
    const name = 'c2703-new-ssh';
    await connectedWindow(name);
    await inWindow(name, 'workbench.action.terminal.new');
    await waitFor(
      'the terminal’s shell on the host',
      async () => (await hostProcesses()).shells.length > 0,
      60_000,
    );
    const hostBefore = await hostProcesses();
    const {before, reconnectedAfter} = await killedSsh(name);
    const after = localSshOfHarness();
    const hostAfter = await hostProcesses();
    deepStrictEqual(
      {
        reconnected: reconnectedAfter !== undefined,
        // `every` over an empty list holds for nothing, so both lists must have an ssh.
        sshBefore: before.length > 0,
        sshAfter: after.length > 0,
        newSsh: after.every(
          each => !before.some(earlier => earlier.processId === each.processId),
        ),
        newPort: after.every(
          each => !before.some(earlier => earlier.port === each.port),
        ),
        found: Object.values(hostBefore).map(list => list.length > 0),
        kept: hostBefore.server
          .concat(hostBefore.shells)
          .every(each =>
            hostAfter.server.concat(hostAfter.shells).includes(each),
          ),
      },
      {
        reconnected: true,
        sshBefore: true,
        sshAfter: true,
        newSsh: true,
        newPort: true,
        found: [true, true],
        kept: true,
      },
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

  it('F-2505 AC-18 (c2703-value-minus-one): the limit -1 behaves like 0: one attempt, then core gives up', async () => {
    const name = 'c2703-value-minus-one';
    await userSettings({'remote.SSH.maxReconnectionAttempts': -1});
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

  it('F-2505 AC-18 (c2703-value-text): the limit "abc" means no limit: the attempts go on past the fourth', async () => {
    const name = 'c2703-value-text';
    await userSettings({'remote.SSH.maxReconnectionAttempts': 'abc'});
    const mark = await connectedWindow(name);
    outageBegins();
    await waitFor(
      'attempt 6',
      () => attemptsSince(mark, 'harness').length >= 5,
      240_000,
    );
    deepStrictEqual(
      [
        attemptsSince(mark, 'harness').map(attempt => attempt.number),
        (await dialogOf(name))?.details === GIVEN_UP,
      ],
      [[2, 3, 4, 5, 6], false],
    );
  });

  it('F-2505 AC-18 (c2703-value-twenty): the limit 20 is not clamped: the attempts go on past the tenth', async () => {
    const name = 'c2703-value-twenty';
    await userSettings({'remote.SSH.maxReconnectionAttempts': 20});
    const mark = await connectedWindow(name);
    outageBegins();
    await waitFor(
      'attempt 12',
      () => attemptsSince(mark, 'harness').length >= 11,
      480_000,
    );
    deepStrictEqual(
      [
        attemptsSince(mark, 'harness').map(attempt => attempt.number),
        (await dialogOf(name))?.details === GIVEN_UP,
      ],
      [[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], false],
    );
  });

  /**
   * Opens window `name` on a host entry of its own that names no ConnectTimeout, which the run's `harness` block does
   * (10 s): the attempts then fail after the extension's 15 s, as on a host that drops packets. Gives the log's length
   * once the window is connected, with `settings` set besides the entry.
   */
  async function windowOnUnboundedHost(
    name: string,
    settings: Readonly<Record<string, unknown>> = {},
  ): Promise<number> {
    const file = writeConfig(name, [hostBlock(name, [], ['ConnectTimeout'])]);
    await userSettings({
      'remote.SSH.configFile': file,
      'remote.SSH.remotePlatform': {[name]: 'linux'},
      ...settings,
    });
    await openWindow(name, name);
    await connectedWithin(name, 120_000);
    return connectionLog().length;
  }

  it('F-2505 AC-28 (c2703-silent): on a host whose packets are dropped an attempt fails after about 15 to 17 s as The connection timed out, a temporary failure, and core keeps retrying', async () => {
    const name = 'c2703-silent';
    const mark = await windowOnUnboundedHost(name);
    outageBegins();
    await waitFor(
      'attempt 5',
      () => attemptsSince(mark, name).length >= 4,
      240_000,
    );
    const attempts = attemptsSince(mark, name);
    const lasted = attempts
      .slice(1, 3)
      .map(attempt =>
        attempt.failedAt === undefined
          ? undefined
          : seconds(between(attempt.startedAt, attempt.failedAt)),
      );
    console.log(
      `F-2505 AC-28: attempts 3 and 4 lasted ${JSON.stringify(lasted)} s`,
    );
    deepStrictEqual(
      [
        // The spec's "about 15 to 17 s", unwidened: ssh gives up after the entry's 15 s ConnectTimeout, never before it, and
        // the extension's own wait is that plus 2 s (17 s), which an attempt that ssh does not end first meets.
        lasted.map(each => each !== undefined && each >= 15 && each <= 17),
        connectionLog()
          .slice(mark)
          .some(line =>
            line.includes('OfflineError (The connection timed out)'),
          ),
        (await dialogOf(name))?.details === GIVEN_UP,
      ],
      [[true, true], true, false],
      `attempts 3 and 4 lasted ${JSON.stringify(lasted)} s`,
    );
  });

  it('F-2505 AC-25 (c2703-old-ssh): when packets stop and core starts reconnecting, the previous connection’s local ssh ends within about 5 s of the first reconnection attempt, counted from core showing Reconnecting, without waiting for an ssh timeout (7 s allowed, the criterion’s 2 s tolerance on the probe’s 3 s bound; the row prints the measured time in every run)', async () => {
    const name = 'c2703-old-ssh';
    await connectedWindow(name);
    const earlier = localSshOfHarness().map(each => each.processId);
    outageBegins();
    // Core starts the reconnection when it shows Reconnecting, which the log's first attempt line follows only once the
    // extension has checked the held connection: counted from the log line the old ssh would be gone at 0 s.
    let reconnectingAt: number | undefined;
    let goneAt: number | undefined;
    const limit = Date.now() + 90_000;
    while (
      (reconnectingAt === undefined || goneAt === undefined) &&
      Date.now() < limit
    ) {
      if (
        reconnectingAt === undefined &&
        (await statusBarText(name, 'status.host').catch(() => '')) ===
          'Reconnecting to SSH: harness...'
      ) {
        reconnectingAt = Date.now();
      }
      if (goneAt === undefined && earlier.every(each => !running(each))) {
        goneAt = Date.now();
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const endedAfter =
      reconnectingAt === undefined || goneAt === undefined
        ? undefined
        : seconds(Math.max(0, goneAt - reconnectingAt));
    // Printed in green runs too, so a drift toward the bound shows before it fails.
    console.log(
      `F-2505 AC-25: the old ssh ended ${String(endedAfter)} s after core showed Reconnecting`,
    );
    deepStrictEqual(
      [earlier.length > 0, endedAfter !== undefined && endedAfter <= 7],
      [true, true],
      `the old ssh ${JSON.stringify(earlier)} ended ${String(endedAfter)} s after core showed Reconnecting`,
    );
  });

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
        resolves.map(line => /attempt 1\b/u.test(line)),
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
    // The grace time reaches core when the server starts, so the server that earlier rows left is replaced. The host
    // entry names no ConnectTimeout, so an attempt fails after 15 s and core's first error after the grace time comes
    // inside the criterion's window.
    await freshHost();
    const mark = await windowOnUnboundedHost(name, {
      'remote.SSH.reconnectionGraceTime': 30,
      'window.dialogStyle': 'custom',
    });
    outageBegins();
    const shown = await givenUp(name);
    const [first] = attemptsSince(mark, name);
    const into = seconds(between(first?.startedAt ?? 0, shown.shownAt));
    // Printed in green runs too, so a drift toward the bound shows before it fails.
    console.log(
      `F-2505 AC-20: core ended the reconnection ${String(into)} s after attempt 2 started`,
    );
    unpauseHost();
    await answerDialog(name, 'Reload Window');
    await connectedWithin(name, 180_000);
    deepStrictEqual(
      // The spec's "about 30 to 40 s", unwidened. The end is the first attempt failure after the grace time, and the
      // schedule fixes it: attempt 2 fails 17 s after it starts (the 15 s ConnectTimeout plus the extension's 2 s),
      // core waits 5 s, and attempt 3 fails 15.2 s after it starts, about 37.2 s in all.
      [shown.details, into >= 30 && into <= 40, into],
      [GIVEN_UP, true, into],
    );
    await freshHost();
  });
});
