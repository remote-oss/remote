import {deepStrictEqual} from 'node:assert';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectionLog,
  emptyWindows,
  inWindow,
  onHost,
  openWindow,
  recordLines,
  signal,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  freshHost,
} from '../windows/maintenance.ts';
import {notifications, portsRows, statusItem} from '../windows/renderer.ts';
import {
  addedSince,
  connectedWith,
  holdPorts,
  keepingSettings,
  listeners,
  PLATFORMS,
  type Listener,
} from '../windows/tunnel-support.ts';

const FAILURE = 'Could not establish connection';
const BUTTONS = ['Close Remote', 'Retry', 'More Actions...'];
const SECOND_SSH = {
  'remote.SSH.useLocalServer': false,
  'remote.SSH.enableDynamicForwarding': false,
};
const TERMINAL_SOCKS = {
  'remote.SSH.useLocalServer': false,
  'remote.SSH.enableDynamicForwarding': true,
};

/** A line of a window's record, as the rows read it. */
interface Seen {
  surface: string;
  question: string;
  details: boolean | undefined;
  buttons: string[] | undefined;
  /** Milliseconds after the window was opened. */
  elapsed: number;
}

/** What a window that was left to fail showed and cost. */
interface Failed {
  lines: Seen[];
  indicator: string;
  added: Listener[];
  logins: number;
}

/** The dialog lines of `failed`. */
function dialogsOf(failed: Failed): Seen[] {
  return failed.lines.filter(line => line.surface === 'failureDialog');
}

/** The first progress line of `failed` that says `question`. */
function phaseOf(failed: Failed, question: string): Seen | undefined {
  return failed.lines.find(
    line => line.surface === 'progress' && line.question === question,
  );
}

/**
 * Holds `port` on both loopbacks of the runner for the length of `body`, so that nothing can bind it and a connect to
 * it is accepted.
 */
async function withPortHeld<Result>(
  ports: readonly number[],
  addresses: readonly string[],
  body: () => Promise<Result>,
): Promise<Result> {
  const held = [];
  for (const address of addresses) {
    held.push(await holdPorts(ports, address));
  }
  try {
    return await body();
  } finally {
    for (const each of held) {
      await each.release();
    }
  }
}

/**
 * Opens window `name` on `alias` under `settings` and leaves it to fail: its dialog is held, so that the indicator is
 * read while it is open, until `milliseconds` have passed; then the dialog is dismissed and the window closed.
 */
async function failing(
  name: string,
  alias: string,
  settings: Readonly<Record<string, unknown>>,
  milliseconds: number,
): Promise<Failed> {
  await userSettings({...PLATFORMS, ...settings});
  const since = new Date().toISOString();
  const before = listeners();
  const start = Date.now();
  appendScript([
    {
      surface: 'failureDialog',
      match: FAILURE,
      answer: 'dismiss',
      window: name,
      after: `c79-${name}`,
    },
  ]);
  await openWindow(alias, name);
  await new Promise(resolve => setTimeout(resolve, milliseconds));
  const failed: Failed = {
    lines: recordLines(undefined, name).map(line => ({
      surface: line.surface,
      question: line.question,
      details: line.details,
      buttons: line.buttons,
      elapsed: line.time - start,
    })),
    indicator: (await statusItem(name, 'status.host')).text,
    added: addedSince(before, listeners()),
    logins: await acceptedKeyLogins(since),
  };
  signal(`c79-${name}`);
  await closeWindow(name).catch(() => undefined);
  return failed;
}

/** Waits until window `name` has a failure dialog in its record. */
function waitForDialogRecord(name: string): Promise<void> {
  return waitFor(
    `a failure dialog of window ${name}`,
    () => recordLines('failureDialog', name).length > 0,
    120_000,
  );
}

describe('the tunnel of a window that its host or its configuration refuses (card coverage-79)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('F-2104 AC-23 (c79-max-wait): with the second ssh and every forward cleared, the progress waits for port forwarding and 10 s later the dialog says the wait is exhausted, also with a connect timeout of 30 s', async () => {
    const seen: Array<
      [boolean, number, string | undefined, string[] | undefined, string]
    > = [];
    for (const settings of [
      SECOND_SSH,
      {...SECOND_SSH, 'remote.SSH.connectTimeout': 30},
    ]) {
      await closeAllButLocal();
      await keepingSettings(async () => {
        const failed = await failing(
          'c79-clear',
          'fwd-clearall',
          settings,
          25_000,
        );
        const waiting = phaseOf(
          failed,
          'Waiting for port forwarding to be ready',
        );
        const dialog = dialogsOf(failed)[0];
        seen.push([
          waiting !== undefined,
          Math.round(
            ((dialog?.elapsed ?? 0) - (waiting?.elapsed ?? Number.NaN)) / 1000,
          ),
          dialog?.question,
          dialog?.buttons,
          failed.indicator,
        ]);
      });
    }
    const exhausted =
      'Could not establish connection to "fwd-clearall": Error establishing tunnel (Max wait time exhausted).';
    deepStrictEqual(seen, [
      [true, 10, exhausted, BUTTONS, 'Disconnected from SSH: fwd-clearall'],
      [true, 10, exhausted, BUTTONS, 'Disconnected from SSH: fwd-clearall'],
    ]);
  });

  it('F-2104 AC-20, AC-21, AC-22, AC-47 (c79-socks-refused): when the host refuses forwarding on the SOCKS path, whether by sshd or by ClearAllForwardings, the window shows the error notification once, with a Show log link and no button, whose command opens the Remote - SSH channel holding the refusal, and its progress waits for port forwarding with no dialog and no success for a minute', async () => {
    const seen: Array<{
      notices: Array<[string, string[] | undefined]>;
      toast: string[];
      indicator: string;
      dialogs: number;
      channel: string | null | undefined;
      refusal: boolean;
      later: number;
      stillWaiting: boolean;
    }> = [];
    for (const alias of ['noforward', 'fwd-clearall']) {
      await closeAllButLocal();
      await keepingSettings(async () => {
        await userSettings({...PLATFORMS});
        const name = `c79-socks-${alias}`;
        appendScript([
          {
            surface: 'notice',
            match: 'Failed to set up',
            answer: 'dismiss',
            window: name,
          },
        ]);
        await openWindow(alias, name);
        await waitFor(
          'the notification',
          () => recordLines('notice', name).length > 0,
          120_000,
        );
        async function toasts(): Promise<string[]> {
          return (await notifications(name)).filter(text =>
            text.includes('Waiting'),
          );
        }
        const toast = await toasts();
        const indicator = (await statusItem(name, 'status.host')).text;
        // The link of the message runs this command, which the row then runs, as the editor does for a click.
        await inWindow(name, 'opensshremotes.showLog');
        await windowState(name);
        const channel = windowEvents(name)
          .filter(entry => entry.event === 'state')
          .at(-1)?.visibleOutputChannel;
        const first = recordLines('notice', name).length;
        await new Promise(resolve => setTimeout(resolve, 60_000));
        seen.push({
          notices: recordLines('notice', name).map(line => [
            line.question,
            line.buttons,
          ]),
          toast,
          indicator,
          dialogs: recordLines('failureDialog', name).length,
          channel,
          refusal: connectionLog().some(line =>
            line.includes('administratively prohibited'),
          ),
          later: recordLines('notice', name).length - first,
          stillWaiting: (await toasts()).length > 0,
        });
        await closeWindow(name);
      });
    }
    const expected = {
      notices: [
        [
          'Failed to set up dynamic port forwarding connection over SSH to the VS Code Server. ([Show log](command:opensshremotes.showLog))',
          [],
        ],
      ],
      toast: [
        'Setting up SSH Host ALIAS: Waiting for port forwarding to be ready',
      ],
      indicator: 'Opening Remote...',
      dialogs: 0,
      channel: 'Remote - SSH',
      refusal: true,
      later: 0,
      stillWaiting: true,
    };
    deepStrictEqual(seen, [
      {...expected, toast: [expected.toast[0]?.replace('ALIAS', 'noforward')]},
      {
        ...expected,
        toast: [expected.toast[0]?.replace('ALIAS', 'fwd-clearall')],
      },
    ]);
  });

  it('connect-106 (c79-socks-dead-server): F-2104 7.E4, a host that refuses forwarding whose server is gone while the tunnel waits ends with the failure dialog at the bound and shows no notice', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c79-socks-dead';
      appendScript([
        {
          surface: 'notice',
          match: 'Failed to set up',
          answer: 'dismiss',
          window: name,
        },
        {
          surface: 'failureDialog',
          match: FAILURE,
          answer: 'dismiss',
          window: name,
          after: 'c79-socks-dead-end',
        },
      ]);
      await openWindow('noforward', name);
      await waitFor(
        'the tunnel to wait for port forwarding',
        () =>
          recordLines('progress', name).some(
            line => line.question === 'Waiting for port forwarding to be ready',
          ),
        120_000,
      );
      // The servers of the host end while the relay's probes are still closed, which the host's check then sees.
      const servers = `${DATA_FOLDER.replace('/.', '/[.]')}/bin/`;
      await onHost('sh', '-c', `pkill -f '${servers}' || true`);
      await waitForDialogRecord(name);
      const lines = recordLines(undefined, name);
      const result = {
        dialogs: lines
          .filter(line => line.surface === 'failureDialog')
          .map(line => line.question),
        notices: lines.filter(line => line.surface === 'notice').length,
        indicator: (await statusItem(name, 'status.host')).text,
      };
      signal('c79-socks-dead-end');
      await closeWindow(name).catch(() => undefined);
      deepStrictEqual(result, {
        dialogs: ['Could not establish connection to "noforward".'],
        notices: 0,
        indicator: 'Disconnected from SSH: noforward',
      });
    });
  });

  it('F-2104 AC-24 (c79-max-wait-close): Close Remote on the dialog of the exhausted wait makes the window an empty local window', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS, ...SECOND_SSH});
      const name = 'c79-clear-close';
      const before = emptyWindows();
      appendScript([
        {
          surface: 'failureDialog',
          match: FAILURE,
          answer: {button: 'Close Remote'},
          window: name,
        },
      ]);
      await openWindow('fwd-clearall', name);
      await waitFor(
        'the window to become an empty window',
        () => emptyWindows().length > before.length,
        120_000,
      );
      const empty = emptyWindows().at(-1) ?? '';
      deepStrictEqual((await windowState(empty)).remoteName, null);
      await closeWindow(empty);
    });
  });

  it('F-2104 AC-25 (c79-exit-busy): with ExitOnForwardFailure and a LocalForward busy on both loopbacks the dialog comes within a second of the start, with no reason', async () => {
    await keepingSettings(async () => {
      await withPortHeld([13020], ['127.0.0.1', '::1'], async () => {
        const failed = await failing(
          'c79-exit-busy',
          'fwd-busy-exit',
          {},
          8000,
        );
        const dialog = dialogsOf(failed)[0];
        deepStrictEqual(
          [
            dialog?.question,
            dialog?.buttons,
            (dialog?.elapsed ?? 99_999) - (failed.lines[0]?.elapsed ?? 0) <
              1000,
            failed.indicator,
          ],
          [
            'Could not establish connection to "fwd-busy-exit".',
            BUTTONS,
            true,
            'Disconnected from SSH: fwd-busy-exit',
          ],
        );
      });
    });
  });

  it('F-2104 AC-26, AC-44 (c79-exit-busy-second): with the second ssh and ExitOnForwardFailure, a LocalForward or a DynamicForward busy on both loopbacks lets the install finish, shows Setting up SSH tunnel with its details link, and the window does not connect', async () => {
    const seen: Array<[string, boolean | undefined, string]> = [];
    for (const [alias, port] of [
      ['fwd-busy-exit', 13020],
      ['fwd-dynamic-exit', 13030],
    ] as const) {
      await closeAllButLocal();
      await keepingSettings(async () => {
        await withPortHeld([port], ['127.0.0.1', '::1'], async () => {
          const failed = await failing(
            'c79-exit-second',
            alias,
            SECOND_SSH,
            8000,
          );
          seen.push([
            alias,
            phaseOf(failed, 'Setting up SSH tunnel')?.details,
            failed.indicator,
          ]);
        });
      });
    }
    deepStrictEqual(seen, [
      ['fwd-busy-exit', true, 'Disconnected from SSH: fwd-busy-exit'],
      ['fwd-dynamic-exit', true, 'Disconnected from SSH: fwd-dynamic-exit'],
    ]);
  });

  it('F-2104 AC-27 (c79-exit-clean): ExitOnForwardFailure with no failing forward connects on the SOCKS path and on the second ssh', async () => {
    const seen: string[] = [];
    for (const settings of [{}, SECOND_SSH]) {
      await closeAllButLocal();
      await keepingSettings(async () => {
        await connectedWith('c79-exit-clean', 'fwd-exit', settings);
        seen.push((await statusItem('c79-exit-clean', 'status.host')).text);
        await closeWindow('c79-exit-clean');
      });
    }
    deepStrictEqual(seen, ['SSH: fwd-exit', 'SSH: fwd-exit']);
  });

  it('F-2104 AC-28 (c79-second-refused): with the second ssh and a host that refuses TCP forwarding the dialog says the connection closed, a few seconds after the tunnel began', async () => {
    await keepingSettings(async () => {
      const failed = await failing(
        'c79-second-refused',
        'noforward',
        SECOND_SSH,
        20_000,
      );
      const dialog = dialogsOf(failed)[0];
      deepStrictEqual(
        [
          dialog?.question,
          dialog?.buttons,
          (dialog?.elapsed ?? 99_999) -
            (phaseOf(failed, 'Setting up SSH tunnel')?.elapsed ?? 0) <
            5000,
        ],
        [
          'Could not establish connection to "noforward": Connection closed.',
          BUTTONS,
          true,
        ],
      );
    });
  });

  it('F-2104 AC-29 (c79-tcp-no-socket): in TCP mode a host that refuses only stream-local forwarding connects with the defaults', async () => {
    await keepingSettings(async () => {
      await connectedWith('c79-tcp-nosocket', 'nosocket', {
        'remote.SSH.remoteServerListenOnSocket': false,
      });
      deepStrictEqual(
        (await statusItem('c79-tcp-nosocket', 'status.host')).text,
        'SSH: nosocket',
      );
      await closeWindow('c79-tcp-nosocket');
    });
  });

  it('F-2104 AC-38 (c79-socket-refused): in socket mode a host that refuses stream-local forwarding gives the dialog that the connection closed', async () => {
    await keepingSettings(async () => {
      const failed = await failing(
        'c79-socket-refused',
        'nosocket',
        {'remote.SSH.remoteServerListenOnSocket': true},
        15_000,
      );
      const dialog = dialogsOf(failed)[0];
      deepStrictEqual(
        [dialog?.question, dialog?.buttons],
        [
          'Could not establish connection to "nosocket": Connection closed.',
          BUTTONS,
        ],
      );
    });
  });

  it('F-2104 AC-40 (c79-exit-busy-one): with ExitOnForwardFailure and a LocalForward busy on 127.0.0.1 only the window connects and the user’s forward is listed in the Ports view', async () => {
    await keepingSettings(async () => {
      await withPortHeld([13020], ['127.0.0.1'], async () => {
        const name = 'c79-exit-one';
        await connectedWith(name, 'fwd-busy-exit', {});
        await waitFor(
          'core to register the Ports view',
          async () =>
            inWindow(name, '~remote.forwardedPorts.focus').then(
              () => true,
              () => false,
            ),
          30_000,
        );
        await waitFor(
          'the forward in the Ports view',
          async () =>
            (await portsRows(name).catch(() => [])).some(entry =>
              entry.port.includes('8660'),
            ),
          60_000,
        );
        deepStrictEqual(
          [
            (await statusItem(name, 'status.host')).text,
            (await portsRows(name))
              .filter(entry => entry.port.includes('8660'))
              .map(entry => [entry.forwardedAddress, entry.origin]),
          ],
          ['SSH: fwd-busy-exit', [['localhost:13020', 'Statically Forwarded']]],
        );
        await closeWindow(name);
      });
    });
  });

  it('F-2104 AC-43 (c79-exit-busy-terminal): with the local server off, dynamic forwarding on and a LocalForward busy on both loopbacks under ExitOnForwardFailure the dialog comes without a reason', async () => {
    await keepingSettings(async () => {
      await withPortHeld([13020], ['127.0.0.1', '::1'], async () => {
        const failed = await failing(
          'c79-exit-terminal',
          'fwd-busy-exit',
          TERMINAL_SOCKS,
          10_000,
        );
        const dialog = dialogsOf(failed)[0];
        deepStrictEqual(
          [dialog?.question, dialog?.buttons, failed.indicator],
          [
            'Could not establish connection to "fwd-busy-exit".',
            BUTTONS,
            'Disconnected from SSH: fwd-busy-exit',
          ],
        );
      });
    });
  });

  it('F-2104 AC-48 (c79-bind-host): a bind host that is not the loopback of the host leaves the window unconnected on the SOCKS path and on the second ssh, with the server listening on that address', async () => {
    const address = variable('HARNESS_ROUTED_ADDRESS');
    const seen: Array<[string, string | undefined, boolean]> = [];
    for (const settings of [{}, SECOND_SSH]) {
      // A server that runs already keeps the address it was started on, so each connect starts one.
      await freshHost();
      await keepingSettings(async () => {
        const failed = await failing(
          'c79-bind-host',
          'harness',
          {...settings, 'remote.SSH.bindHost': {harness: address}},
          25_000,
        );
        seen.push([
          failed.indicator,
          dialogsOf(failed)[0]?.question,
          (await onHost('netstat', '-ltn')).includes(`${address}:`),
        ]);
      });
    }
    deepStrictEqual(seen, [
      // On the SOCKS path the refused forward keeps the progress and shows the notification, with no dialog.
      ['Opening Remote...', undefined, true],
      [
        'Disconnected from SSH: harness',
        'Could not establish connection to "harness".',
        true,
      ],
    ]);
  });

  it('F-2104 AC-37 (c79-socket-password): in socket mode a password host is asked twice, the second while Setting up SSH tunnel shows, an ssh process holds the window port on 127.0.0.1 only, the host logs two logins and the window connects', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-socket-pw', 'password', {
        'remote.SSH.remoteServerListenOnSocket': true,
      });
      const second = connected.sequence.lastIndexOf(
        'maskedInput:Enter password for harness-pw@127.0.0.1',
      );
      const sshListeners = connected.added.filter(
        each => each.program === 'ssh',
      );
      deepStrictEqual(
        [
          connected.prompts,
          connected.logins,
          connected.sequence.indexOf('progress:Setting up SSH tunnel') < second,
          recordLines('progress', 'c79-socket-pw').find(
            line => line.question === 'Setting up SSH tunnel',
          )?.details,
          connected.sequence.indexOf(
            'progress:Waiting for port forwarding to be ready',
          ) > second,
          sshListeners.map(each => each.address),
          (await statusItem('c79-socket-pw', 'status.host')).text,
        ],
        [2, 2, true, true, true, ['127.0.0.1'], 'SSH: password'],
      );
      await closeWindow('c79-socket-pw');
    });
  });

  it('F-2104 AC-39 (c79-no-exec-server): with the local server, dynamic forwarding and the exec server all off a password host is asked twice and the window connects', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-no-exec', 'password', {
        ...SECOND_SSH,
        'remote.SSH.useExecServer': false,
      });
      deepStrictEqual(
        [
          connected.prompts,
          (await statusItem('c79-no-exec', 'status.host')).text,
        ],
        [2, 'SSH: password'],
      );
      await closeWindow('c79-no-exec');
    });
  });
});
