import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  openWindow,
  onHostAs,
  readUserSettings,
  inWindow,
  nextEmptyWindow,
  recordLines,
  reloadWindow,
  terminalsOf,
  userSettings,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {hostSessionIds} from '../windows/pty-support.ts';
import {closeAllButLocal, freshHost} from '../windows/maintenance.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';
import {
  contributionsNow,
  DISPLAY_PROBE,
  environmentContributions,
  heldDisplay,
  inDebugger,
  inTask,
  inTerminal,
  ownContributions,
  x11Close,
  x11Window,
} from '../windows/x11-support.ts';

/** The first line the probe prints, a display of the forwarded kind. */
const DISPLAY_LINE = /^DISPLAY=localhost:\d+\.0\n/;

/** The X client's own report of its connection to the display. */
const CONNECTED = /\nname of display: +localhost:\d+\.0\n/;

describe('F-2312: X11 forwarding into the remote environment', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2312 AC-3, AC-4 (c84-task-debug): a shell task and a node launch configuration see the window’s display and run an X client on it', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-task-debug', 'x11fwd');
      const terminal = await inTerminal('c84-task-debug', DISPLAY_PROBE);
      const task = await inTask('c84-task-debug', DISPLAY_PROBE);
      const debugged = await inDebugger('c84-task-debug', DISPLAY_PROBE);
      function display(text: string): string {
        return text.split('\n')[0] ?? '';
      }
      deepStrictEqual(
        [
          display(task),
          display(debugged),
          CONNECTED.test(task),
          CONNECTED.test(debugged),
        ],
        [display(terminal), display(terminal), true, true],
      );
      await x11Close('c84-task-debug');
    });
  });

  it('F-2312 AC-15 (c84-terminal): with the local server off the terminal, the task and the debugger have the display too', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-terminal', 'x11fwd', {
        'remote.SSH.useLocalServer': false,
      });
      const terminal = await inTerminal('c84-terminal', DISPLAY_PROBE);
      const contributed = await environmentContributions('c84-terminal');
      const task = await inTask('c84-terminal', DISPLAY_PROBE);
      const debugged = await inDebugger('c84-terminal', DISPLAY_PROBE);
      deepStrictEqual(
        [terminal, task, debugged]
          .map(text => DISPLAY_LINE.test(text) && CONNECTED.test(text))
          .concat(/DISPLAY=localhost:\d+\.0/.test(contributed)),
        [true, true, true, true],
      );
      await x11Close('c84-terminal');
    });
  });

  it('F-2312 AC-16 (c84-trusted): the SECURITY extension is listed with ForwardX11Trusted yes and not by default', async () => {
    await keepingSettings(async () => {
      const seen: string[] = [];
      for (const alias of ['x11fwd', 'x11-untrusted']) {
        await closeAllButLocal();
        await x11Window('c84-trusted', alias);
        const text = await inTerminal('c84-trusted', DISPLAY_PROBE);
        seen.push(
          `${DISPLAY_LINE.test(text) && CONNECTED.test(text) ? 'works' : 'fails'} ${text.trim().split('\n').at(-1) ?? ''}`,
        );
        await x11Close('c84-trusted');
      }
      deepStrictEqual(seen, ['works 1', 'works 0']);
    });
  });

  it('F-2312 AC-20 (c84-match): ForwardX11 given only in a Match block that applies to the host gives the display', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-match', 'x11-match');
      const terminal = await inTerminal('c84-match', DISPLAY_PROBE);
      const contributed = await environmentContributions('c84-match');
      deepStrictEqual(
        [
          DISPLAY_LINE.test(terminal),
          CONNECTED.test(terminal),
          /DISPLAY=localhost:\d+\.0/.test(contributed),
        ],
        [true, true, true],
      );
      await x11Close('c84-match');
    });
  });

  it('F-2312 AC-13 (c84-off-after): turning the setting off in a connected window shows nothing, and new terminals keep the display', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-off-after', 'x11fwd');
      const before = await inTerminal('c84-off-after', DISPLAY_PROBE);
      await userSettings({'remote.SSH.enableX11Forwarding': false});
      await new Promise(resolve => setTimeout(resolve, 3000));
      const after = await inTerminal('c84-off-after', DISPLAY_PROBE);
      deepStrictEqual(
        [after.split('\n')[0], recordLines('notice', 'c84-off-after').length],
        [before.split('\n')[0], 0],
      );
      await x11Close('c84-off-after');
    });
  });

  it('F-2312 AC-24 (c84-contributions): Show Environment Contributions lists the extension’s section with the DISPLAY entry and no other X variable', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-contributions', 'x11fwd');
      await inTerminal('c84-contributions', 'true');
      const text = await environmentContributions('c84-contributions');
      const entry = await inTerminal(
        'c84-contributions',
        'echo "X=$DISPLAY"; echo "A=$XAUTHORITY"',
      );
      deepStrictEqual(
        [
          ownContributions(text).map(each => each.replace(/\d+\.0$/, 'N.0')),
          text.includes('XAUTHORITY'),
          entry.includes('A=\n') || entry.endsWith('A='),
        ],
        [['DISPLAY=localhost:N.0'], false, true],
      );
      await x11Close('c84-contributions');
    });
  });

  it('F-2312 AC-6 (c84-quiet): the connection shows no notice, dialog, input or terminal of the feature and completes', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-quiet', 'x11fwd');
      deepStrictEqual(
        [
          [
            'notice',
            'failureDialog',
            'maskedInput',
            'textInput',
            'hostPick',
          ].flatMap(surface => recordLines(surface, 'c84-quiet')),
          await terminalsOf('c84-quiet'),
        ],
        [[], []],
      );
      await x11Close('c84-quiet');
    });
  });

  it('F-2312 AC-14 (c84-second-window): a second window on the active host gets the same display, and its clients work after the first window closes', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-first', 'x11fwd');
      const first = await inTerminal('c84-first', DISPLAY_PROBE);
      const second = await nextEmptyWindow(() =>
        inWindow('c84-first', 'opensshremotes.openEmptyWindowOnCurrentHost'),
      );
      await connectedWithin(second, 90_000).catch(() => undefined);
      await waitFor(
        'the second window to be remote',
        async () => (await windowState(second)).remoteName === 'ssh-remote',
        90_000,
      );
      await x11Close('c84-first');
      const later = await inTerminal(second, DISPLAY_PROBE);
      deepStrictEqual(
        [later.split('\n')[0], CONNECTED.test(later)],
        [first.split('\n')[0], true],
      );
      await x11Close(second);
    });
  });

  it('F-2312 AC-17, AC-28 (c84-timeout): after the cookie’s minute a client fails to open the display while DISPLAY stays set, also after a reload', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-timeout', 'x11-timeout');
      await new Promise(resolve => setTimeout(resolve, 70_000));
      const late = await inTerminal('c84-timeout', DISPLAY_PROBE);
      await reloadWindow('c84-timeout');
      await connectedWithin('c84-timeout', 90_000);
      const reloaded = await inTerminal('c84-timeout', DISPLAY_PROBE);
      deepStrictEqual(
        [
          DISPLAY_LINE.test(late),
          late.includes('unable to open display'),
          DISPLAY_LINE.test(reloaded),
          reloaded.includes('unable to open display'),
        ],
        [true, true, true, true],
      );
      await x11Close('c84-timeout');
    });
  });

  it('F-2312 AC-18 (c84-noauth): with an xauth the client cannot find the connection succeeds with no UI, no DISPLAY is contributed and a new terminal has an empty DISPLAY', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-noauth', 'x11-noauth');
      const text = await inTerminal('c84-noauth', 'echo "DISPLAY=[$DISPLAY]"');
      deepStrictEqual(
        [
          text.trim(),
          ownContributions(await contributionsNow('c84-noauth')),
          recordLines('notice', 'c84-noauth').length,
          recordLines('failureDialog', 'c84-noauth').length,
        ],
        ['DISPLAY=[]', [], 0, 0],
      );
      await x11Close('c84-noauth');
    });
  });

  it('F-2312 AC-26 (c84-reload): with the setting turned off in the window, after Reload Window with the local server running the contribution and new terminals still have the display', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-reload', 'x11fwd');
      const before = await inTerminal('c84-reload', DISPLAY_PROBE);
      await userSettings({'remote.SSH.enableX11Forwarding': false});
      await new Promise(resolve => setTimeout(resolve, 3000));
      await reloadWindow('c84-reload');
      await connectedWithin('c84-reload', 90_000);
      const after = await inTerminal('c84-reload', DISPLAY_PROBE);
      const contributed = await environmentContributions('c84-reload');
      deepStrictEqual(
        [
          after.split('\n')[0],
          CONNECTED.test(after),
          /DISPLAY=localhost:\d+\.0/.test(contributed),
        ],
        [before.split('\n')[0], true, true],
      );
      await x11Close('c84-reload');
    });
  });

  it('F-2312 AC-32 (c84-terminal-reload): with the local server off a reload makes a new connection, a new sshd session, and the new terminals have the display', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-terminal-reload', 'x11fwd', {
        'remote.SSH.useLocalServer': false,
      });
      const before = await hostSessionIds();
      await reloadWindow('c84-terminal-reload');
      await connectedWithin('c84-terminal-reload', 90_000);
      const after = await hostSessionIds();
      const text = await inTerminal('c84-terminal-reload', DISPLAY_PROBE);
      deepStrictEqual(
        [
          before.length > 0,
          after.length > 0,
          after.some(each => !before.includes(each)),
          DISPLAY_LINE.test(text),
          CONNECTED.test(text),
        ],
        [true, true, true, true, true],
      );
      await x11Close('c84-terminal-reload');
    });
  });

  it('F-2312 AC-19 (c84-forbidden): on a host that forbids X11 forwarding the connection succeeds with no UI, no DISPLAY is contributed and a new terminal on a freshly started server has an empty DISPLAY', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-forbidden', 'x11-forbidden');
      const text = await inTerminal(
        'c84-forbidden',
        'echo "DISPLAY=[$DISPLAY]"',
      );
      deepStrictEqual(
        [
          text.trim(),
          ownContributions(await contributionsNow('c84-forbidden')),
          recordLines('notice', 'c84-forbidden').length,
          recordLines('failureDialog', 'c84-forbidden').length,
        ],
        ['DISPLAY=[]', [], 0, 0],
      );
      await x11Close('c84-forbidden');
    });
  });

  it('F-2312 AC-22 (c84-writes): connecting with X11 forwarding writes no setting and leaves no file on the host beyond .Xauthority', async () => {
    await keepingSettings(async () => {
      async function filesAfter(alias: string): Promise<string[]> {
        await x11Window('c84-writes', alias);
        const listed = await onHostAs(
          'harness',
          'sh',
          '-c',
          "find /home/harness -type f -not -path '*/.vscodium-server*' -not -path '*/.local/state/*' -not -path '*/c84-writes/*' | sort",
        );
        await x11Close('c84-writes');
        return listed.split('\n').filter(line => line !== '');
      }
      const without = await filesAfter('harness');
      const settingsBefore = readUserSettings();
      const withX11 = await filesAfter('x11fwd');
      deepStrictEqual(
        [
          withX11.filter(file => !without.includes(file)),
          readUserSettings() === settingsBefore,
        ],
        [['/home/harness/.Xauthority'], true],
      );
    });
  });

  it('F-2312 AC-27 (c84-new-connection): with the setting turned off, a new connection after Kill Local Connection Server contributes no DISPLAY', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-new-connection', 'x11fwd');
      await inTerminal('c84-new-connection', 'true');
      await userSettings({'remote.SSH.enableX11Forwarding': false});
      await new Promise(resolve => setTimeout(resolve, 3000));
      appendScript([
        {
          surface: 'hostPick',
          match: '',
          answer: {label: 'x11fwd'},
          window: 'c84-new-connection',
        },
      ]);
      await inWindow('c84-new-connection', 'opensshremotes.cleanLocalServer');
      await waitFor(
        'the sessions to end',
        async () => (await hostSessionIds()).length === 0,
        60_000,
      );
      await waitFor(
        'the reconnection',
        async () => (await hostSessionIds()).length > 0,
        120_000,
      );
      await connectedWithin('c84-new-connection', 120_000);
      await inTerminal('c84-new-connection', 'true');
      deepStrictEqual(
        ownContributions(await contributionsNow('c84-new-connection')),
        [],
      );
      await x11Close('c84-new-connection');
    });
  });

  it('F-2312 AC-29, AC-30 (c84-new-display): after Kill Local Connection Server the window reconnects with another display; a new terminal and a shell task get it, an old terminal keeps its display until it is relaunched', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      await freshHost();
      const holder = heldDisplay();
      try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        await openWindow('x11fwd', 'c84-new-display');
        await connectedWithin('c84-new-display', 90_000);
        const oldTerminal = await inTerminal(
          'c84-new-display',
          'echo "$DISPLAY"',
        );
        holder.end();
        await new Promise(resolve => setTimeout(resolve, 3000));
        appendScript([
          {
            surface: 'hostPick',
            match: '',
            answer: {label: 'x11fwd'},
            window: 'c84-new-display',
          },
        ]);
        await inWindow('c84-new-display', 'opensshremotes.cleanLocalServer');
        await waitFor(
          'the sessions to end',
          async () => (await hostSessionIds()).length === 0,
          60_000,
        );
        await waitFor(
          'the contribution to name another display',
          async () =>
            ownContributions(await contributionsNow('c84-new-display')).some(
              entry => !entry.includes(oldTerminal.trim()),
            ),
          120_000,
        );
        const stillOld = await inTerminal(
          'c84-new-display',
          'echo "$DISPLAY"',
          true,
        );
        await inWindow('c84-new-display', 'workbench.action.terminal.relaunch');
        await new Promise(resolve => setTimeout(resolve, 5000));
        const relaunched = await inTerminal(
          'c84-new-display',
          'echo "$DISPLAY"',
          true,
        );
        const fresh = await inTerminal('c84-new-display', DISPLAY_PROBE);
        const task = await inTask('c84-new-display', DISPLAY_PROBE);
        deepStrictEqual(
          [
            stillOld.trim() === oldTerminal.trim(),
            relaunched.trim() !== oldTerminal.trim(),
            fresh.split('\n')[0] === `DISPLAY=${relaunched.trim()}`,
            CONNECTED.test(fresh),
            task.split('\n')[0] === `DISPLAY=${relaunched.trim()}`,
            CONNECTED.test(task),
          ],
          [true, true, true, true, true, true],
        );
      } finally {
        holder.end();
        await x11Close('c84-new-display');
      }
    });
  });
});
