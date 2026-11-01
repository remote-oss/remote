import {deepStrictEqual} from 'node:assert';
import type {PortChoice} from '../../src/pipeline/port-choice.ts';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import type {TunnelSettings} from 'lib-forwarding';
import {FakeLocalPort} from 'lib-forwarding/testing/fake-network';
import {
  type Forward,
  type Invocation,
  type ConnectWaitSettings,
  setupMarkerOf,
  TUNNEL_SUCCESS_LINE,
  type TerminalLogin,
} from 'lib-ssh';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {openTunnelStep} from '../../src/pipeline/tunnel-step.ts';
import type {StartedServer} from 'lib-server';
import {emptyRecording, INPUT, leaseOf, STARTED} from './pipeline.fixture.ts';

const SECOND_SSH: TunnelSettings = {
  listenOnSocket: false,
  useLocalServer: false,
  enableDynamicForwarding: false,
};

const SOCKET: TunnelSettings = {...SECOND_SSH, listenOnSocket: true};

const LIMITS = {
  readyMilliseconds: 50,
  retryMilliseconds: 10,
  heldBytesMaximum: 8,
};

const ENVIRONMENT = {
  extensionHostEnv: {SSH_AUTH_SOCK: '/tmp/agent'},
  environmentTunnels: [],
};

const LOCAL_PORT = 50000;

/** The line `ssh` prints when the key exchange is done, after which a question nobody sees is bounded. */
const HANDSHAKE = 'debug1: SSH2_MSG_NEWKEYS received';

const SOCKET_SERVER: StartedServer = {
  ...STARTED.server,
  endpoint: {kind: 'socket', path: '/tmp/code-ab'},
};

/** The failure line `ssh` prints when our forward could not be set up. */
const FORWARD_FAILURE = 'Could not request local forwarding.';

/** A tunnel step over fakes, with the terminal it opens and everything it asked of its surroundings. */
function stepWith(
  options: {
    settings?: TunnelSettings;
    settingsNow?: () => TunnelSettings;
    server?: StartedServer;
    port?: number | undefined;
    busyRange?: {first: number; last: number};
    reveal?: boolean;
    connectScript?: Array<'work' | 'fail' | 'hang'>;
    connectWait?: ConnectWaitSettings;
    retryMilliseconds?: number;
    input?: string;
  } = {},
) {
  const clock = new FakeClock();
  const local = new FakeLocalPort('work', options.connectScript ?? ['work']);
  const terminals = new RecordingTerminals();
  const sink = new MemorySink();
  const forwards: Forward[] = [];
  const questions: string[] = [];
  const logins: TerminalLogin[] = [];
  const disposals = {questions: 0};
  let waits = 0;
  let portsChosen = 0;
  const port = 'port' in options ? options.port : LOCAL_PORT;
  const choice: PortChoice =
    options.busyRange !== undefined
      ? {busyRange: options.busyRange}
      : port === undefined
        ? {noPort: true}
        : {port};
  const step = openTunnelStep({
    settings: () => options.settingsNow?.() ?? options.settings ?? SECOND_SSH,
    local,
    scheduler: clock.scheduler(),
    limits: {...LIMITS, retryMilliseconds: options.retryMilliseconds ?? 10},
    dialerFor: () => {
      throw new Error('a terminal path does not dial through the relay');
    },
    chooseLocalPort: () => {
      portsChosen += 1;
      return Promise.resolve(choice);
    },
    environment: () => ENVIRONMENT,
    terminals,
    tunnelInvocation: (forward): Invocation => {
      forwards.push(forward);
      return {program: 'ssh', arguments: ['tunnel'], environment: {}};
    },
    tunnelInput: () => options.input,
    attachQuestions: login => {
      logins.push(login);
      return {
        onQuestion: text => {
          questions.push(text);
        },
        dispose: () => {
          disposals.questions += 1;
        },
      };
    },
    revealLoginTerminals: () => options.reveal ?? false,
    connectWait: () =>
      options.connectWait ?? {
        connectTimeoutSeconds: 0,
        fromHost: false,
        unboundedWaitSeconds: 600,
      },
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
  });
  const lease = leaseOf(emptyRecording());
  function opened() {
    const [terminal] = terminals.opened;
    if (terminal === undefined) {
      throw new Error('no tunnel terminal was opened');
    }
    return terminal;
  }
  const cancellation = new AbortController();
  return {
    cancellation,
    tunnelPath: () => step.tunnelPath(),
    open: () =>
      step.openTunnel(
        INPUT,
        lease,
        options.server ?? STARTED.server,
        () => {
          waits += 1;
        },
        cancellation.signal,
      ),
    local,
    terminals,
    opened,
    sink,
    clock,
    forwards,
    questions,
    logins,
    disposals,
    waits: () => waits,
    portsChosen: () => portsChosen,
  };
}

/** Lets the step reach the point where it waits on the terminal. */
async function settled(): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await Promise.resolve();
  }
}

/** Runs the clock forward in steps, letting promises settle between them. */
async function advance(
  clock: FakeClock,
  milliseconds: number,
  step = 10,
): Promise<void> {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    await settled();
    clock.advance(step);
  }
  await settled();
}

describe('the step that opens the window tunnel, secondSsh and socket paths (card connect-18)', () => {
  it('F-2104 BR-1: the second-ssh path opens one SSH Tunnel terminal, for a port endpoint', async () => {
    const {open, terminals, forwards} = stepWith();
    void open();
    await settled();
    deepStrictEqual(
      [terminals.opened.map(terminal => terminal.name), forwards],
      [
        ['SSH Tunnel'],
        [{kind: 'local', localPort: LOCAL_PORT, remotePort: 4321}],
      ],
    );
  });

  it('F-2107 BR-1: the line the step is given as the tunnel run’s input is written to the terminal as soon as it opens, and with none nothing is', async () => {
    const withInput = stepWith({input: 'exec sh -c cmd\n'});
    void withInput.open();
    await settled();
    const without = stepWith();
    void without.open();
    await settled();
    deepStrictEqual(
      [withInput.terminals.opened[0]?.sent, without.terminals.opened[0]?.sent],
      [['exec sh -c cmd\n'], []],
    );
  });

  it('F-2410 5.0: the socket path forwards to the socket endpoint', async () => {
    const {open, forwards} = stepWith({
      settings: SOCKET,
      server: SOCKET_SERVER,
    });
    void open();
    await settled();
    deepStrictEqual(forwards, [
      {kind: 'socket', localPort: LOCAL_PORT, socketPath: '/tmp/code-ab'},
    ]);
  });

  it('F-2104 BR-9: no free local port opens no terminal and fails without a reason', async () => {
    const {open, terminals} = stepWith({port: undefined});
    deepStrictEqual(
      [await open(), terminals.opened.length],
      [{kind: 'failed', failure: {kind: 'unknown'}}, 0],
    );
  });

  it('F-2104.AC-14: a busy preferred range opens no terminal and fails with the reason of its text, on the second-ssh path', async () => {
    const {open, terminals} = stepWith({
      busyRange: {first: 41060, last: 41061},
    });
    deepStrictEqual(
      [await open(), terminals.opened.length],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'unknown',
            reason: {
              id: 'S067',
              values: [
                {
                  id: 'S073',
                  values: [{id: 'S095', values: ['41060', '41061']}],
                },
              ],
            },
          },
        },
        0,
      ],
    );
  });

  it('#299: the second-ssh path given a socket endpoint is a defect that throws', async () => {
    const {open} = stepWith({server: SOCKET_SERVER});
    await open().then(
      () => {
        throw new Error('it did not throw');
      },
      (caught: unknown) => {
        deepStrictEqual(
          caught instanceof Error && caught.message.includes('port endpoint'),
          true,
        );
      },
    );
  });

  it('#299: the socket path given a port endpoint is a defect that throws', async () => {
    const {open} = stepWith({settings: SOCKET});
    await open().then(
      () => {
        throw new Error('it did not throw');
      },
      (caught: unknown) => {
        deepStrictEqual(
          caught instanceof Error && caught.message.includes('socket endpoint'),
          true,
        );
      },
    );
  });

  it('F-2308 BR-3: the terminal is revealed at its open when the setting asks', async () => {
    const {open, opened} = stepWith({reveal: true});
    void open();
    await settled();
    deepStrictEqual(opened().revealedAtOpen, true);
  });

  it('athena on #352: a question the tunnel login prints reaches the questions', async () => {
    const {open, opened, questions, clock} = stepWith();
    void open();
    await settled();
    opened().write("alex@dev's password: ");
    await advance(clock, 120);
    deepStrictEqual(questions, ["alex@dev's password: "]);
  });

  it('F-2003 BR-8: every line of the SSH Tunnel terminal is logged as ssh’s, including a refused channel', async () => {
    const {open, opened, sink} = stepWith();
    void open();
    await settled();
    opened().write(
      'channel 3: open failed: administratively prohibited: open failed\nWarning: remote port forwarding failed\n',
    );
    await settled();
    deepStrictEqual(
      sink.lines
        .map(line => line.message)
        .filter(message => message.startsWith('[ssh] ')),
      [
        '[ssh] channel 3: open failed: administratively prohibited: open failed',
        '[ssh] Warning: remote port forwarding failed',
      ],
    );
  });

  it('F-2104 7.E10: the terminal ending before the success line fails without a reason', async () => {
    const {open, opened} = stepWith();
    const pending = open();
    await settled();
    opened().end(255);
    deepStrictEqual(await pending, {
      kind: 'failed',
      failure: {kind: 'unknown'},
    });
  });

  it('#299: a forward-failure line then the success line fails, stops the session and logs the line', async () => {
    const {open, opened, sink} = stepWith();
    const pending = open();
    await settled();
    opened().write(`${FORWARD_FAILURE}\n${TUNNEL_SUCCESS_LINE}\n`);
    const result = await pending;
    deepStrictEqual(
      [
        result,
        opened().disposed,
        sink.lines.some(line => line.message.includes(FORWARD_FAILURE)),
      ],
      [{kind: 'failed', failure: {kind: 'unknown'}}, true, true],
    );
  });

  it('F-2104 6.2 step 5: the success line tells the caller the forward is awaited, once', async () => {
    const {open, opened, waits} = stepWith();
    void open();
    await settled();
    opened().write(`${TUNNEL_SUCCESS_LINE}\n`);
    await settled();
    deepStrictEqual(waits(), 1);
  });

  it('F-2104 BR-10: a port that never accepts fails after 10 s with the max-wait reason', async () => {
    const {open, opened, clock} = stepWith({
      connectScript: ['fail'],
    });
    const pending = open();
    await settled();
    opened().write(`${TUNNEL_SUCCESS_LINE}\n`);
    await advance(clock, 10_100, 100);
    deepStrictEqual(await pending, {
      kind: 'failed',
      failure: {
        kind: 'unknown',
        reason: {id: 'S067', values: [{id: 'S089', values: []}]},
      },
    });
  });

  it('#299: the 10 s count starts at the success line: a port that accepts 9 s after it opens the tunnel, though the login took 60 s', async () => {
    const {open, opened, clock} = stepWith({
      retryMilliseconds: 1000,
      connectScript: [
        'fail',
        'fail',
        'fail',
        'fail',
        'fail',
        'fail',
        'fail',
        'fail',
        'work',
      ],
    });
    const pending = open();
    await settled();
    await advance(clock, 60_000, 1000);
    opened().write(`${TUNNEL_SUCCESS_LINE}\n`);
    await advance(clock, 9_500, 500);
    deepStrictEqual((await pending).kind, 'done');
  });

  /** A second-ssh tunnel that opened: its login printed the success line and its port accepted. */
  async function succeeded() {
    const context = stepWith();
    const pending = context.open();
    await settled();
    context.opened().write(`${TUNNEL_SUCCESS_LINE}\n`);
    await advance(context.clock, 30);
    const result = await pending;
    if (result.kind !== 'done') {
      throw new Error('the tunnel did not open');
    }
    return {...context, tunnel: result.value};
  }

  it('F-2104 6.2: the success line then a port that accepts is done, at the local address', async () => {
    const {tunnel} = await succeeded();
    deepStrictEqual(tunnel.opened.address, {
      host: '127.0.0.1',
      port: LOCAL_PORT,
    });
  });

  it('#299 ruling 1b: the handshake line the test prints is the one the reader knows', () => {
    deepStrictEqual(setupMarkerOf(HANDSHAKE), 'handshake');
  });

  /** A tunnel login that printed the handshake and then a question no one recognises, with the step still pending. */
  async function silentQuestion(connectWait: ConnectWaitSettings) {
    const context = stepWith({connectWait});
    const pending = context.open();
    let outcome: Awaited<typeof pending> | undefined;
    void pending.then(result => {
      outcome = result;
    });
    await settled();
    context.opened().write(`${HANDSHAKE}\nSomething odd? `);
    await settled();
    return {...context, outcome: () => outcome};
  }

  const TEN_SECONDS: ConnectWaitSettings = {
    connectTimeoutSeconds: 10,
    fromHost: false,
    unboundedWaitSeconds: 600,
  };

  it('#299 ruling 1b: a question nobody can see fails the step as a timeout once the connect wait has passed', async () => {
    const {clock, outcome} = await silentQuestion(TEN_SECONDS);
    await advance(clock, 12_100, 100);
    deepStrictEqual(outcome(), {kind: 'failed', failure: {kind: 'timeout'}});
  });

  it('#299 ruling 1b: the failed step has stopped the session', async () => {
    const {clock, opened} = await silentQuestion(TEN_SECONDS);
    await advance(clock, 12_100, 100);
    deepStrictEqual(opened().disposed, true);
  });

  it('#299 ruling 1b: just before the connect wait has passed the step is still waiting', async () => {
    const {clock, outcome} = await silentQuestion(TEN_SECONDS);
    await advance(clock, 11_900, 100);
    deepStrictEqual(outcome(), undefined);
  });

  const SETTING_ZERO: ConnectWaitSettings = {
    connectTimeoutSeconds: 0,
    fromHost: false,
    unboundedWaitSeconds: 600,
  };

  it('athena on #385: a timeout of 0 does not give a bound of 0 ms', async () => {
    const {clock, outcome} = await silentQuestion(SETTING_ZERO);
    await advance(clock, 1_000, 100);
    deepStrictEqual(outcome(), undefined);
  });

  it("athena on #385: the setting's timeout of 0 is bounded by the 2 s margin, not by the ceiling", async () => {
    const {clock, outcome} = await silentQuestion(SETTING_ZERO);
    await advance(clock, 2_100, 100);
    deepStrictEqual(outcome(), {kind: 'failed', failure: {kind: 'timeout'}});
  });

  it("athena on #385: a host's timeout of 0 waits the ceiling", async () => {
    const {clock, outcome} = await silentQuestion({
      connectTimeoutSeconds: 0,
      fromHost: true,
      unboundedWaitSeconds: 600,
    });
    await advance(clock, 599_000, 1_000);
    deepStrictEqual(outcome(), undefined);
  });

  it('R1: the step names the second-ssh path from the settings', () => {
    deepStrictEqual(stepWith().tunnelPath(), 'secondSsh');
  });

  it('R1: the step names the socket path from the settings', () => {
    deepStrictEqual(stepWith({settings: SOCKET}).tunnelPath(), 'socket');
  });

  it('R1: the path is read once for a connect, so the step takes the branch it named', async () => {
    let current: TunnelSettings = SECOND_SSH;
    const context = stepWith({settingsNow: () => current});
    context.tunnelPath();
    current = {
      listenOnSocket: false,
      useLocalServer: true,
      enableDynamicForwarding: true,
    };
    void context.open();
    await settled();
    deepStrictEqual(context.terminals.opened.length, 1);
  });

  it('contracts: a cancel during the login settles the step as cancelled', async () => {
    const {open, cancellation} = stepWith();
    const pending = open();
    await settled();
    cancellation.abort();
    deepStrictEqual(await pending, {
      kind: 'failed',
      failure: {kind: 'cancelled'},
    });
  });

  it('contracts: a cancel during the login stops the session', async () => {
    const {open, opened, cancellation} = stepWith();
    void open();
    await settled();
    cancellation.abort();
    await settled();
    deepStrictEqual(opened().disposed, true);
  });

  it('contracts: a cancel during the login takes the questions down', async () => {
    const {open, cancellation, disposals} = stepWith();
    void open();
    await settled();
    cancellation.abort();
    await settled();
    deepStrictEqual(disposals.questions, 1);
  });

  it('contracts: a cancel while a question is open still takes the questions down once', async () => {
    const {open, opened, cancellation, disposals, clock} = stepWith();
    void open();
    await settled();
    opened().write("alex@dev's password: ");
    await advance(clock, 120);
    cancellation.abort();
    await settled();
    deepStrictEqual(disposals.questions, 1);
  });

  it('contracts: a cancel during the 10 s wait settles the step as cancelled and stops the session', async () => {
    const {open, opened, cancellation, clock} = stepWith({
      connectScript: ['fail'],
    });
    const pending = open();
    await settled();
    opened().write(`${TUNNEL_SUCCESS_LINE}\n`);
    await advance(clock, 100);
    cancellation.abort();
    await advance(clock, 100);
    deepStrictEqual(
      [await pending, opened().disposed],
      [{kind: 'failed', failure: {kind: 'cancelled'}}, true],
    );
  });

  it('contracts: a connect already cancelled opens no terminal', async () => {
    const context = stepWith();
    context.cancellation.abort();
    deepStrictEqual(
      [await context.open(), context.terminals.opened.length],
      [{kind: 'failed', failure: {kind: 'cancelled'}}, 0],
    );
  });

  it('contracts: a connect already cancelled does not even choose a local port', async () => {
    const context = stepWith();
    context.cancellation.abort();
    await context.open();
    deepStrictEqual(context.portsChosen(), 0);
  });

  it('contracts: a cancel while the local port is being chosen opens no terminal', async () => {
    const context = stepWith();
    const pending = context.open();
    context.cancellation.abort();
    deepStrictEqual(
      [await pending, context.terminals.opened.length],
      [{kind: 'failed', failure: {kind: 'cancelled'}}, 0],
    );
  });

  it('contracts: closing the opened tunnel twice stops the session once', async () => {
    const {tunnel, opened, terminals} = await succeeded();
    tunnel.close();
    tunnel.close();
    deepStrictEqual([opened().disposed, terminals.opened.length], [true, 1]);
  });

  /** An opened second-ssh tunnel with the listeners it heard. */
  async function openedWithHeard() {
    const context = await succeeded();
    const heard: string[] = [];
    context.tunnel.onClosed(detail => {
      heard.push(detail);
    });
    return {...context, heard};
  }

  it('contracts §W2: the tunnel terminal ending after success tells each listener once', async () => {
    const {opened, heard} = await openedWithHeard();
    opened().end(255);
    opened().end(255);
    deepStrictEqual(heard, ['the tunnel ssh ended']);
  });

  it('contracts §W2: a close the caller asked for, then the terminal ending, tells no listener', async () => {
    const {opened, heard, tunnel} = await openedWithHeard();
    tunnel.close();
    opened().end(undefined);
    deepStrictEqual(heard, []);
  });

  it('contracts §W2: a listener registered after the end hears it at once', async () => {
    const {opened, tunnel} = await openedWithHeard();
    opened().end(255);
    const late: string[] = [];
    tunnel.onClosed(detail => {
      late.push(detail);
    });
    deepStrictEqual(late, ['the tunnel ssh ended']);
  });

  it('F-2104 Q4: a successful second-ssh tunnel offers no port forwarding of its own', async () => {
    const {tunnel} = await openedWithHeard();
    deepStrictEqual(
      ['tunnelFactory' in tunnel.opened, 'tunnelFeatures' in tunnel.opened],
      [false, false],
    );
  });
});
