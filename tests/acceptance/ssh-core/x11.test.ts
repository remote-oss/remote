import {deepStrictEqual} from 'node:assert';
import {readdirSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {
  appendScript,
  connectedWithin,
  connectionLog,
  openWindow,
  onHostAs,
  readUserSettings,
  inWindow,
  nextEmptyWindow,
  recordLines,
  reloadWindow,
  terminalsOf,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {hostSessionIds, hostSessions} from '../windows/pty-support.ts';
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

/** The files of the client that are not logs, caches or the editor's own state, as kinds: ids and numbers become placeholders. */
function clientFileKinds(): string[] {
  const roots: Array<[string, string]> = [
    [variable('HARNESS_USER_DATA'), 'USER'],
    [variable('HARNESS_RUN_FOLDER'), 'RUN'],
    [path.join(homedir(), '.ssh'), 'SSH'],
  ];
  const noise =
    /\/logs\/|\.log$|state\.vscdb|Cache|Local Storage|Session Storage|blob_storage|Network|Crashpad|WebStorage|Service Worker|Dictionaries|\.lock|Local State|Preferences|Cookies|DIPS|machineid|storage\.json|\.jsonl$|\/agent\/|-record|-log\.txt|workspace\.json/;
  function files(folder: string): string[] {
    return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
      const full = path.join(folder, entry.name);
      return entry.isDirectory() ? files(full) : [full];
    });
  }
  return roots
    .flatMap(([folder, label]) =>
      files(folder).map(file => `${label}/${path.relative(folder, file)}`),
    )
    .filter(file => !noise.test(file))
    .map(file => file.replace(/[0-9a-f]{32}/g, 'H').replace(/\d+/g, 'N'))
    .sort();
}

/** Runs New Window on Active Host in window `name` and gives the empty window it opens; a window that does not open adds the windows and the log to the error. */
async function newWindowFrom(name: string): Promise<string> {
  try {
    return await nextEmptyWindow(() =>
      inWindow(name, 'opensshremotes.openEmptyWindowOnCurrentHost'),
    );
  } catch (caught) {
    throw new Error(
      `${String(caught)}; the windows: ${JSON.stringify(windowNames())}; ${name}'s last events: ${JSON.stringify(windowEvents(name).slice(-6))}\nthe log:\n${connectionLog().slice(-40).join('\n')}`,
      {cause: caught},
    );
  }
}

/** Waits until none of the sessions `before` of the account `harness` runs on the host any more (a reconnection may already have opened others); a wait that runs out names the sessions and the processes of ssh that remain. */
async function sessionsEnded(before: readonly string[]): Promise<void> {
  try {
    await waitFor(
      'the sessions to end',
      async () =>
        (await hostSessionIds()).every(session => !before.includes(session)),
      60_000,
    );
  } catch (caught) {
    throw new Error(
      `${String(caught)}; the sessions: ${(await hostSessions()).join(' | ')}; the processes: ${await onHostAs('harness', 'sh', '-c', "ps -o pid,ppid,etime,args | grep -E 'ssh|sleep' | grep -v grep; true")}`,
      {cause: caught},
    );
  }
}

/** The number of processes of the host’s connection servers, the ones started with `--start-server`. */
async function serverCount(): Promise<number> {
  const listed = await onHostAs(
    'harness',
    'sh',
    '-c',
    "pgrep -u harness -f '[-][-]start-server' | wc -l",
  );
  return Number(listed.trim());
}

/** The `DISPLAY=` lines of the environments of the host's connection servers, each once. */
async function serverDisplays(): Promise<string[]> {
  const listed = await onHostAs(
    'harness',
    'sh',
    '-c',
    "for pid in $(pgrep -u harness -f '[-][-]start-server'); do tr '\\0' '\\n' < /proc/$pid/environ | grep '^DISPLAY='; done | sort -u",
  );
  return listed.split('\n').filter(line => line !== '');
}

/** The first line of an X client probe's output, the `DISPLAY=` line. */
function display(text: string): string {
  return text.split('\n')[0] ?? '';
}

/** Opens window `name` on `alias` with `settings` and gives what the feature leaves of a connection that gets no display: the new terminal's `DISPLAY`, the contributed entries and the notices and dialogs. */
async function noDisplayAt(
  name: string,
  alias: string,
  settings: Readonly<Record<string, unknown>> = {},
): Promise<[string, string[], number, number]> {
  await x11Window(name, alias, settings);
  const text = await inTerminal(name, 'echo "DISPLAY=[$DISPLAY]"');
  const seen: [string, string[], number, number] = [
    text.trim(),
    ownContributions(await contributionsNow(name)),
    recordLines('notice', name).length,
    recordLines('failureDialog', name).length,
  ];
  await x11Close(name);
  return seen;
}

describe('F-2312: X11 forwarding into the remote environment', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2312 AC-3, AC-4 (c84-task-debug): a shell task and a node launch configuration see the window’s display and run an X client on it', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-task-debug', 'x11fwd');
      const terminal = await inTerminal('c84-task-debug', DISPLAY_PROBE);
      const task = await inTask('c84-task-debug', DISPLAY_PROBE);
      const debugged = await inDebugger('c84-task-debug', DISPLAY_PROBE);
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
      const second = await newWindowFrom('c84-first');
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
      deepStrictEqual(await noDisplayAt('c84-noauth', 'x11-noauth'), [
        'DISPLAY=[]',
        [],
        0,
        0,
      ]);
    });
  });

  it('F-2312 AC-18 (c84-bad-display): with a local DISPLAY that ssh cannot set up untrusted forwarding for the connection succeeds with ssh’s warning, no UI, no DISPLAY is contributed and a new terminal has an empty DISPLAY', async () => {
    await keepingSettings(async () => {
      const mark = connectionLog().length;
      deepStrictEqual(
        [
          await noDisplayAt('c84-bad-display', 'x11-untrusted', {
            'remote.SSH.path': path.join(
              variable('HARNESS_RUN_FOLDER'),
              'clients/bad-display/ssh',
            ),
          }),
          connectionLog()
            .slice(mark)
            .some(line =>
              line.includes('untrusted X11 forwarding setup failed'),
            ),
        ],
        [['DISPLAY=[]', [], 0, 0], true],
      );
    });
  });

  it('F-2312 AC-10 (c84-held): a window that connects to a server started in a session that still holds display 10 gets its own display in the terminal, the task and the debugger', async () => {
    await keepingSettings(async () => {
      await x11Window('c84-held-a', 'x11fwd');
      const held = await inTerminal('c84-held-a', 'echo "DISPLAY=$DISPLAY"');
      const servers = await serverCount();
      const environment = await serverDisplays();
      await openWindow('x11-match', 'c84-held-b');
      await connectedWithin('c84-held-b', 90_000);
      const terminal = await inTerminal('c84-held-b', DISPLAY_PROBE);
      const task = await inTask('c84-held-b', DISPLAY_PROBE);
      const debugged = await inDebugger('c84-held-b', DISPLAY_PROBE);
      deepStrictEqual(
        [
          [servers > 0, servers, await serverCount(), environment],
          [terminal, task, debugged].map(display),
          display(terminal) === held.trim(),
          [terminal, task, debugged].map(text => CONNECTED.test(text)),
          ownContributions(await contributionsNow('c84-held-b')),
        ],
        [
          [true, servers, servers, [held.trim()]],
          [display(terminal), display(terminal), display(terminal)],
          false,
          [true, true, true],
          [display(terminal)],
        ],
      );
      await x11Close('c84-held-b');
      await x11Close('c84-held-a');
    });
  });

  it('F-2312 AC-23 (c84-ended): a window that connects to a server started in an X11 session that has ended gets no DISPLAY contributed, a terminal with the ended session’s display, and clients fail on it', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      await freshHost();
      await openWindow('x11fwd', 'c84-ended-a');
      await connectedWithin('c84-ended-a', 90_000);
      const ended = await inTerminal('c84-ended-a', 'echo "DISPLAY=$DISPLAY"');
      await x11Close('c84-ended-a');
      appendScript([
        {
          surface: 'hostPick',
          match: '',
          answer: {label: 'x11fwd'},
          window: 'local',
        },
      ]);
      const before = await hostSessionIds();
      await inWindow('local', 'opensshremotes.cleanLocalServer');
      await sessionsEnded(before);
      await openWindow('harness', 'c84-ended-b');
      await connectedWithin('c84-ended-b', 90_000);
      const terminal = await inTerminal('c84-ended-b', DISPLAY_PROBE);
      deepStrictEqual(
        [
          display(terminal),
          CONNECTED.test(terminal),
          ownContributions(await contributionsNow('c84-ended-b')),
          ['notice', 'failureDialog', 'maskedInput', 'textInput'].flatMap(
            surface => recordLines(surface, 'c84-ended-b'),
          ),
        ],
        [ended.trim(), false, [], []],
      );
      await x11Close('c84-ended-b');
    });
  });

  it('F-2312 AC-12 (c84-export): with the setting off and a server started without X11, the display sshd opened for the window works when it is exported by hand', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      await freshHost();
      await openWindow('harness', 'c84-export-a');
      await connectedWithin('c84-export-a', 90_000);
      await x11Close('c84-export-a');
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.enableX11Forwarding': false,
      });
      await openWindow('x11fwd', 'c84-export');
      await connectedWithin('c84-export', 90_000);
      const empty = await inTerminal('c84-export', 'echo "DISPLAY=[$DISPLAY]"');
      const exported = await inTerminal(
        'c84-export',
        'number=$(netstat -ltn | grep -o "127.0.0.1:60[0-9][0-9]" | head -1 | cut -d: -f2); DISPLAY=localhost:$((number - 6000)).0 xdpyinfo | sed -n 1p',
      );
      deepStrictEqual(
        [empty.trim(), CONNECTED.test(`\n${exported}`)],
        ['DISPLAY=[]', true],
      );
      await x11Close('c84-export');
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
      deepStrictEqual(await noDisplayAt('c84-forbidden', 'x11-forbidden'), [
        'DISPLAY=[]',
        [],
        0,
        0,
      ]);
    });
  });

  it('F-2312 AC-22 (c84-writes): connecting with X11 forwarding writes no setting and leaves no file on the host beyond .Xauthority, nor on the client beyond what a plain connect leaves', async () => {
    await keepingSettings(async () => {
      async function hostFilesAfter(alias: string): Promise<string[]> {
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
      // Earlier rows of the file leave the host's .Xauthority and the alias's known hosts behind: start without them.
      await onHostAs('harness', 'rm', '-f', '/home/harness/.Xauthority');
      rmSync(path.join(variable('HARNESS_RUN_FOLDER'), 'known_hosts_x11fwd'), {
        force: true,
      });
      const clientBefore = clientFileKinds();
      const without = await hostFilesAfter('harness');
      const clientPlain = clientFileKinds();
      const settingsBefore = readUserSettings();
      const withX11 = await hostFilesAfter('x11fwd');
      const clientX11 = clientFileKinds();
      const plainKinds = clientPlain.filter(
        kind => !clientBefore.includes(kind),
      );
      deepStrictEqual(
        [
          withX11.filter(file => !without.includes(file)),
          readUserSettings() === settingsBefore,
          clientX11
            .filter(kind => !clientPlain.includes(kind))
            .filter(kind => !plainKinds.includes(kind)),
        ],
        [['/home/harness/.Xauthority'], true, ['RUN/known_hosts_xNfwd']],
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
      const before = await hostSessionIds();
      await inWindow('c84-new-connection', 'opensshremotes.cleanLocalServer');
      await sessionsEnded(before);
      await waitFor(
        'the reconnection',
        async () =>
          (await hostSessionIds()).some(session => !before.includes(session)),
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

  it('F-2312 AC-29, AC-30 (c84-new-display): after Kill Local Connection Server the window reconnects with another display and no UI; the contribution is exactly the new display, a new terminal and a shell task get it, and two older terminals, one typed into and one not, keep the old display until each is relaunched', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      await freshHost();
      const holder = heldDisplay();
      const name = 'c84-new-display';
      try {
        await new Promise(resolve => setTimeout(resolve, 5000));
        await openWindow('x11fwd', name);
        await connectedWithin(name, 90_000);
        const typed = (await inTerminal(name, 'echo "$DISPLAY"')).trim();
        await inWindow(name, 'workbench.action.terminal.new');
        await new Promise(resolve => setTimeout(resolve, 3000));
        const surfaces = [
          'notice',
          'failureDialog',
          'maskedInput',
          'textInput',
        ];
        function interruptions(): number {
          return surfaces.flatMap(surface => recordLines(surface, name)).length;
        }
        holder.end();
        await new Promise(resolve => setTimeout(resolve, 3000));
        appendScript([
          {
            surface: 'hostPick',
            match: '',
            answer: {label: 'x11fwd'},
            window: name,
          },
        ]);
        const before = await hostSessionIds();
        await inWindow(name, 'opensshremotes.cleanLocalServer');
        await sessionsEnded(before);
        await waitFor(
          'the contribution to name another display',
          async () =>
            ownContributions(await contributionsNow(name)).some(
              entry => !entry.includes(typed),
            ),
          120_000,
        );
        const contributed = ownContributions(await contributionsNow(name));
        async function displayIn(
          index: number,
          relaunch: boolean,
        ): Promise<string> {
          await inWindow(
            name,
            `workbench.action.terminal.focusAtIndex${String(index)}`,
          );
          if (relaunch) {
            await inWindow(name, 'workbench.action.terminal.relaunch');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          return (await inTerminal(name, 'echo "$DISPLAY"', true)).trim();
        }
        const typedOld = await displayIn(1, false);
        const untypedOld = await displayIn(2, false);
        const typedNew = await displayIn(1, true);
        const untypedNew = await displayIn(2, true);
        const fresh = await inTerminal(name, DISPLAY_PROBE);
        const task = await inTask(name, DISPLAY_PROBE);
        deepStrictEqual(
          [
            contributed.length,
            contributed[0] === `DISPLAY=${typedNew}`,
            interruptions(),
            typedOld === typed,
            untypedOld === typed,
            typedNew !== typed,
            untypedNew === typedNew,
            fresh.split('\n')[0] === `DISPLAY=${typedNew}`,
            CONNECTED.test(fresh),
            task.split('\n')[0] === `DISPLAY=${typedNew}`,
            CONNECTED.test(task),
          ],
          [1, true, 0, true, true, true, true, true, true, true, true],
        );
      } finally {
        holder.end();
        await x11Close(name);
      }
    });
  });
});
