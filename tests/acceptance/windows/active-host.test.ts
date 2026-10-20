import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {sshRemoteCodec} from 'lib-authority';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  acceptedPasswords,
  appendScript,
  closeWindow,
  connectedWithin,
  connected,
  connectionLog,
  cutHostNetwork,
  cutRoute,
  dirtyDocumentsOf,
  emptyWindows,
  heldLines,
  inWindow,
  logins,
  nextEmptyName,
  nextEmptyWindow,
  onHost,
  onHostAs,
  openWindow,
  readUserSettings,
  recordLines,
  restoreHostNetwork,
  restoreRoute,
  restoreUserSettings,
  signal,
  terminalsOf,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from './harness.ts';
import {
  alignScript,
  closeAllButLocal,
  dismissals,
  harnessPort,
  INSTALL_MILLISECONDS,
  openConnected,
  password,
  perWindowMode,
  setting,
  settingsText,
} from './maintenance.ts';

/** The authority of a window on the `harness` alias. */
const HARNESS_AUTHORITY = 'ssh-remote+harness';

/** Runs New Window on Active Host in window `name` and gives the name of the one empty window it opens. */
function newWindowFrom(name: string): Promise<string> {
  return nextEmptyWindow(() =>
    inWindow(name, 'opensshremotes.openEmptyWindowOnCurrentHost'),
  );
}

/** The password entries for window `name`: a connect over a socket logs in once for the server and once for the tunnel. */
function passwordAnswers(name: string): AppendedEntry[] {
  return Array.from({length: 2}, () => ({...password(), window: name}));
}

/** Resolves as `waiting` does; when it fails, adds window `name`'s record, events and the connection log to the error. */
async function diagnosed(name: string, waiting: Promise<void>): Promise<void> {
  try {
    await waiting;
  } catch (caught) {
    const lines = recordLines()
      .filter(line => line.window === name)
      .map(line => `${line.surface}: ${line.question}`);
    throw new Error(
      `${String(caught)}; ${name}'s record:\n${lines.join('\n')}\nits events: ${JSON.stringify(windowEvents(name).slice(-8))}\nthe log:\n${connectionLog()
        .filter(line => !line.startsWith('[remote]'))
        .slice(-60)
        .join('\n')}`,
      {cause: caught},
    );
  }
}

/** Waits for the window that replaces a failed empty window on Retry: an empty window not among `known`. */
async function reloadedWindow(known: readonly string[]): Promise<string> {
  let found = '';
  await waitFor(
    'the failed window to reload',
    () => {
      found = emptyWindows().find(name => !known.includes(name)) ?? '';
      return (
        found !== '' &&
        windowEvents(found).some(each => each.event === 'activated')
      );
    },
    60_000,
  );
  return found;
}

/** Waits until empty window `name` is connected: its resolver has written the authority it resolved to. */
function emptyConnectedWithin(
  name: string,
  milliseconds: number,
): Promise<void> {
  return diagnosed(
    name,
    waitFor(
      `${name} to be connected`,
      async () => {
        try {
          return (await windowState(name)).remoteAuthority !== null;
        } catch {
          return false;
        }
      },
      milliseconds,
    ),
  );
}

/** The entries of the profile's global state, by key: the editor's `state.vscdb`, read between its writes. */
async function globalState(): Promise<Map<string, string>> {
  const file = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'user-data/User/globalStorage/state.vscdb',
  );
  for (let attempt = 1; ; attempt += 1) {
    const database = new DatabaseSync(file, {readOnly: true});
    try {
      const rows = database
        .prepare('SELECT key, value FROM ItemTable')
        .all() as Array<{key: string; value: string}>;
      return new Map(rows.map(entry => [entry.key, entry.value]));
    } catch (caught) {
      if (attempt === 20) {
        throw caught;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
      database.close();
    }
  }
}

/** The names whose entry differs between `before` and `after`, added, changed or removed, sorted. */
function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/** The Remote - SSH extension's global state: the entries it stored under its own key, by name. */
async function extensionState(): Promise<Record<string, unknown>> {
  const stored = (await globalState()).get('remote-oss.remote-ssh');
  return stored === undefined
    ? {}
    : (JSON.parse(stored) as Record<string, unknown>);
}

describe('New Window on Active Host (card coverage-42)', function () {
  this.timeout(600_000);

  /** The settings file and the extension's global state when the first window is connected. */
  let settingsBefore = '';
  let stateBefore: Record<string, unknown> = {};

  before(closeAllButLocal);

  /** The windows the rows after the first two read. */
  const opened: {second: string; third: string} = {second: '', third: ''};

  it('F-2303 AC-4, AC-5, AC-6, AC-7: from a connected window a new empty window opens on the same host, connects with no login and no question, and leaves the first alone', async () => {
    await openConnected('a1');
    await new Promise(resolve => setTimeout(resolve, 5000));
    settingsBefore = settingsText();
    stateBefore = await extensionState();
    const before = await logins();
    const mark = recordLines().length;
    const firstBefore = await windowState('a1');
    const began = Date.now();
    const second = await newWindowFrom('a1');
    const openedAfter = Date.now() - began;
    await emptyConnectedWithin(second, 5000);
    const stateAfter = await windowState('a1');
    const stateOfSecond = await windowState(second);
    const lines = recordLines()
      .slice(mark)
      .map(line => `${line.window}:${line.surface}`);
    opened.second = second;
    deepStrictEqual(
      {
        quickly: openedAfter < 3000,
        first: [stateAfter.remoteAuthority, stateAfter.folders.length],
        firstUnchanged:
          JSON.stringify(stateAfter) === JSON.stringify(firstBefore),
        authority: stateOfSecond.remoteAuthority,
        folders: stateOfSecond.folders,
        lines: lines.filter(
          each => each.startsWith(`${second}:`) || each.startsWith('a1:'),
        ),
        logins: (await logins()) - before,
      },
      {
        quickly: true,
        first: [HARNESS_AUTHORITY, 1],
        firstUnchanged: true,
        authority: HARNESS_AUTHORITY,
        folders: [],
        lines: [],
        logins: 0,
      },
    );
  });

  it('F-2303 AC-20: the new window changes no setting and stores no global state but its session record', async () => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    deepStrictEqual(
      [
        settingsText() === settingsBefore,
        changedKeys(stateBefore, await extensionState()),
      ],
      [true, []],
    );
  });

  it('F-2303 AC-8: from the new window another opens on the same host with no login', async () => {
    const before = await logins();
    const third = await newWindowFrom(opened.second);
    await emptyConnectedWithin(third, 5000);
    opened.third = third;
    deepStrictEqual(
      [(await windowState(third)).remoteAuthority, (await logins()) - before],
      [HARNESS_AUTHORITY, 0],
    );
  });

  it('F-2303 AC-9: closing the first window leaves the others connected, and the command still opens a window', async () => {
    await closeWindow('a1');
    const stillThere = [opened.second, opened.third].map(name =>
      emptyWindows().includes(name),
    );
    const fourth = await newWindowFrom(opened.third);
    await emptyConnectedWithin(fourth, 5000);
    deepStrictEqual(
      [
        stillThere,
        (await windowState(opened.second)).remoteAuthority,
        (await windowState(opened.third)).remoteAuthority,
        (await windowState(fourth)).remoteAuthority,
      ],
      [[true, true], HARNESS_AUTHORITY, HARNESS_AUTHORITY, HARNESS_AUTHORITY],
    );
    await closeWindow(fourth);
    await closeWindow(opened.third);
    await closeWindow(opened.second);
  });

  it('F-2303 AC-10 (wiring): a window on the typed user, host and port opens its new window on the same authority with no new login', async () => {
    const authority = sshRemoteCodec.encode({
      kind: 'host',
      hostName: '127.0.0.1',
      user: 'harness',
      port: Number(harnessPort()),
    });
    await openWindow(authority, 'a2');
    await connectedWithin('a2', 60_000);
    const before = await logins();
    const next = await newWindowFrom('a2');
    await emptyConnectedWithin(next, 5000);
    deepStrictEqual(
      [
        (await windowState(next)).remoteAuthority,
        (await windowState('a2')).remoteAuthority,
        (await logins()) - before,
      ],
      [`ssh-remote+${authority}`, `ssh-remote+${authority}`, 0],
    );
    await closeWindow(next);
    await closeWindow('a2');
  });

  it('F-2303 AC-13: from a password window the new window connects with no question of its own', async () => {
    appendScript([{...password(), window: 'pwa'}]);
    await openWindow('password', 'pwa');
    await connectedWithin('pwa', 60_000);
    const before = await acceptedPasswords();
    const mark = recordLines().length;
    const next = await newWindowFrom('pwa');
    await emptyConnectedWithin(next, 5000);
    deepStrictEqual(
      [
        recordLines('maskedInput', next).filter(line => line.time > 0).length,
        recordLines()
          .slice(mark)
          .filter(line => line.window === next).length,
        (await acceptedPasswords()) - before,
      ],
      [0, 0, 0],
    );
    await closeWindow(next);
  });

  describe('in per-window mode', () => {
    before(async () => {
      await closeAllButLocal();
      await setting('remote.SSH.remotePlatform', {
        harness: 'linux',
        password: 'linux',
      });
      await setting('remote.SSH.useLocalServer', false);
      appendScript([{...password(), window: 'pwa'}]);
      await openWindow('password', 'pwa');
      await connectedWithin('pwa', 60_000);
    });

    after(async () => {
      await closeAllButLocal();
      await perWindowMode(false);
    });

    describe('and a password dismissed in the new window', () => {
      /** What the new window asked and showed before Retry, and the windows that existed then. */
      const seen = {
        asked: [] as string[],
        failed: [] as string[],
        others: 0,
        windows: [] as string[],
        before: 0,
        name: '',
      };

      before(async () => {
        seen.before = await acceptedPasswords();
        appendScript([
          {
            surface: 'maskedInput',
            match: 'Enter password',
            answer: 'dismiss',
            window: nextEmptyName(),
          },
          {
            surface: 'failureDialog',
            match: 'Could not establish connection',
            answer: {button: 'Retry'},
            window: nextEmptyName(),
            after: 'active-host-retry',
          },
        ]);
        seen.name = await newWindowFrom('pwa');
        await waitFor(
          `${seen.name}'s failure dialog`,
          () => heldLines(seen.name).length > 0,
          60_000,
        );
        seen.failed = heldLines(seen.name).map(line => line.question);
        seen.asked = recordLines('maskedInput', seen.name).map(
          line => line.question,
        );
        seen.others = recordLines('failureDialog', 'pwa').length;
        seen.windows = emptyWindows();
      });

      it('F-2303 AC-14: the new window shows its own progress and asks for the password itself', () => {
        deepStrictEqual(
          [
            recordLines('progress', seen.name).map(line => line.question)[0],
            seen.asked,
          ],
          [
            'Setting up SSH Host password',
            ['Enter password for harness-pw@127.0.0.1'],
          ],
        );
      });

      it('F-2303 AC-15 (ruling-253-dismiss): the dismissed password fails the new window alone, as F-2306 7.E2 has it', () => {
        deepStrictEqual(
          [seen.failed, seen.others],
          [
            [
              'Could not establish connection to "password": Permission denied (password,keyboard-interactive).',
            ],
            0,
          ],
        );
      });

      it('F-2303 AC-16: Retry asks the password again and connects', async () => {
        appendScript([{...password(), window: nextEmptyName()}]);
        signal('active-host-retry');
        const reopened = await reloadedWindow(seen.windows);
        await diagnosed(
          reopened,
          waitFor(
            `${reopened} to log in`,
            async () => (await acceptedPasswords()) > seen.before,
            30_000,
          ),
        );
        await emptyConnectedWithin(reopened, 60_000);
        deepStrictEqual((await acceptedPasswords()) - seen.before, 1);
      });
    });

    afterEach(restoreRoute);

    it('F-2303 AC-17: a new window whose route is cut fails alone with no route to host, and connects on Retry once the route is back', async () => {
      await setting('remote.SSH.remotePlatform', {
        harness: 'linux',
        password: 'linux',
        routed: 'linux',
      });
      await openWindow('routed', 'a1');
      await connectedWithin('a1', 60_000);
      cutRoute('unreachable');
      appendScript([
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: {button: 'Retry'},
          window: nextEmptyName(),
          after: 'active-host-route',
        },
      ]);
      const name = await newWindowFrom('a1');
      await waitFor(
        `${name}'s failure dialog`,
        () => heldLines(name).length > 0,
        60_000,
      );
      const first = heldLines(name)[0]?.question;
      const known = emptyWindows();
      restoreRoute();
      signal('active-host-route');
      await emptyConnectedWithin(await reloadedWindow(known), 60_000);
      deepStrictEqual(
        first,
        'Could not establish connection to "routed": No route to host.',
      );
    });
  });

  describe('with settings of its own', () => {
    let savedSettings: string | undefined;

    before(async () => {
      await closeAllButLocal();
      savedSettings = readUserSettings();
    });

    afterEach(async () => {
      restoreUserSettings(savedSettings);
      await closeAllButLocal();
    });

    it('F-2303 AC-18: no window opens from a local window, a failed one, a connecting one or a reconnecting one', async () => {
      const settings = settingsText();
      appendScript(dismissals('f1'));
      await openWindow('refused', 'f1');
      await waitFor(
        'the failure of f1',
        () => recordLines('failureDialog', 'f1').length > 0,
        60_000,
      );
      await openWindow('blackhole', 'f2');
      await openConnected('a1');
      function starts(): number {
        return recordLines('progress', 'a1').filter(line =>
          line.question.startsWith('Setting up SSH Host'),
        ).length;
      }
      const startsBefore = starts();
      cutHostNetwork();
      try {
        await waitFor(
          'a1 to try again',
          () => starts() >= startsBefore + 1,
          180_000,
        );
        const windows = emptyWindows();
        for (const name of ['local', 'f1', 'f2', 'a1']) {
          await inWindow(name, 'opensshremotes.openEmptyWindowOnCurrentHost');
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
        deepStrictEqual([emptyWindows(), settingsText()], [windows, settings]);
      } finally {
        restoreHostNetwork();
      }
    });

    it('F-2303 AC-21: from a multi-root workspace window with unsaved text the new window has no folder, no workspace and no dirty editor', async () => {
      // With the default, closing a window that holds unsaved text asks to save it first.
      await userSettings({'files.hotExit': 'onExitAndWindowClose'});
      await onHost(
        'sh',
        '-c',
        `mkdir -p /home/harness/w1 /home/harness/w2 && printf '%s' '{"folders":[{"path":"w1"},{"path":"w2"}]}' > /home/harness/active.code-workspace`,
      );
      const workspace = await nextEmptyWindow(() =>
        inWindow(
          'local',
          'acceptance.agent.openWindow',
          'vscode-remote://ssh-remote+harness/home/harness/active.code-workspace',
        ),
      );
      await waitFor(
        `${workspace} to show its workspace`,
        async () => (await windowState(workspace)).workspaceFile !== null,
        60_000,
      );
      await inWindow(workspace, 'acceptance.agent.openUntitled', 'typed text');
      const name = await newWindowFrom(workspace);
      await emptyConnectedWithin(name, 5000);
      const created = await windowState(name);
      const first = await windowState(workspace);
      deepStrictEqual(
        [
          created.folders,
          created.workspaceFile,
          await dirtyDocumentsOf(name),
          first.workspaceFile?.endsWith('/active.code-workspace'),
          (await dirtyDocumentsOf(workspace)).length,
        ],
        [[], null, [], true, 1],
      );
    });

    it('F-2303 AC-22: with the server listening on a socket the new window asks for the password itself', async () => {
      await userSettings({'remote.SSH.remoteServerListenOnSocket': true});
      // The password account's server the earlier rows left listens on a port, not on a socket.
      await onHostAs(
        'harness-pw',
        'sh',
        '-c',
        "pkill -f '[.]vscodium-server-insiders/' || true; rm -rf /home/harness-pw/.vscodium-server-insiders",
      );
      appendScript(passwordAnswers('pwb'));
      await openWindow('password', 'pwb');
      await connectedWithin('pwb', INSTALL_MILLISECONDS);
      alignScript('pwb');
      const before = await acceptedPasswords();
      appendScript(passwordAnswers(nextEmptyName()));
      const name = await newWindowFrom('pwb');
      await diagnosed(
        name,
        waitFor(
          `${name} to log in`,
          async () => (await acceptedPasswords()) > before,
          60_000,
        ),
      );
      deepStrictEqual(
        [
          recordLines('progress', name).length > 0,
          recordLines('maskedInput', name).length > 0,
          (await acceptedPasswords()) > before,
        ],
        [true, true, true],
      );
    });

    it('F-2303 AC-23: with dynamic forwarding off the new window connects with no question', async () => {
      await userSettings({'remote.SSH.enableDynamicForwarding': false});
      appendScript([{...password(), window: 'pwa'}]);
      await openWindow('password', 'pwa');
      await connectedWithin('pwa', 60_000);
      const before = await acceptedPasswords();
      const name = await newWindowFrom('pwa');
      await emptyConnectedWithin(name, 5000);
      deepStrictEqual(
        [
          recordLines('maskedInput', name).length,
          (await acceptedPasswords()) - before,
        ],
        [0, 0],
      );
    });

    it('F-2303 AC-26: with terminals hidden on start-up the new window opens none', async () => {
      await userSettings({'terminal.integrated.hideOnStartup': 'always'});
      await openConnected('a1');
      const name = await newWindowFrom('a1');
      await emptyConnectedWithin(name, 5000);
      deepStrictEqual(await terminalsOf(name), []);
    });
  });

  describe('the clear command', () => {
    /** Runs Clear All Session Hints in window `name`. */
    function clear(name: string): Promise<void> {
      return inWindow(name, 'opensshremotes.clearAllSessionHints');
    }

    before(async () => {
      await closeAllButLocal();
      await openConnected('a1');
    });

    after(closeAllButLocal);

    it('F-2605 AC-20: the command writes no record line, keeps the window connected and leaves the hint store absent', async () => {
      const mark = recordLines().length;
      await clear('a1');
      deepStrictEqual(
        [
          recordLines().length - mark,
          await connected('a1'),
          Object.keys(await extensionState()).filter(
            key => key === 'remote.ssh.hints',
          ),
        ],
        [0, true, []],
      );
    });

    it('F-2605 AC-21: with the store already empty the command resolves and writes no record line', async () => {
      const mark = recordLines().length;
      await clear('a1');
      deepStrictEqual(recordLines().length - mark, 0);
    });

    it('F-2605 AC-23: with remote.SSH.experimental.chat off the command resolves and the settings file holds nothing the row did not write', async () => {
      const saved = readUserSettings();
      try {
        await userSettings({'remote.SSH.experimental.chat': false});
        const written = settingsText();
        const mark = recordLines().length;
        await clear('a1');
        deepStrictEqual(
          [recordLines().length - mark, settingsText(), await connected('a1')],
          [0, written, true],
        );
      } finally {
        restoreUserSettings(saved);
      }
    });
  });

  after(async () => {
    // The rows leave answers no question used, and the password account's server listening on a socket.
    for (const name of ['pwa', 'pwb']) {
      alignScript(name);
    }
    await onHostAs(
      'harness-pw',
      'sh',
      '-c',
      "pkill -f '[.]vscodium-server-insiders/' || true; rm -rf /home/harness-pw/.vscodium-server-insiders",
    );
  });
});
