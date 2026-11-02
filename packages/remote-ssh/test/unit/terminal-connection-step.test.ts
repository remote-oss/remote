import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {NOISE_LINES} from 'lib-host/testing/noise';
import type {HostChannel} from 'lib-host';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  classify,
  type ConnectionNotice,
  type LoginTerminalName,
  type SessionRunner,
  type SharedRecord,
  type SshRequest,
} from 'lib-ssh';
import {RecordingTerminals} from 'lib-ssh/testing/recording-terminal';
import {
  openTerminalConnectionStep,
  type TerminalConnectionDependencies,
} from '../../src/pipeline/terminal-connection-step.ts';
import type {
  ConnectInput,
  ConnectionLease,
  ConnectionTerms,
  StepResult,
} from '../../src/pipeline/steps.ts';

const INPUT: ConnectInput = {
  target: {kind: 'plain', text: 'dev'},
  rawHostString: 'dev',
  attempt: 1,
  isReconnection: false,
  windowId: 'window-1',
  windowWorkspace: undefined,
};

const TERMS: ConnectionTerms = {platform: 'linux', remoteCommandInEffect: true};

const CHANNEL = {identity: () => 'dev'} as unknown as HostChannel;

const RECORD: SharedRecord = {
  remotePort: 1,
  operatingSystem: 'linux',
  architecture: 'x64',
  temporaryFolder: '/tmp',
  connectionToken: 'token',
};

const AUTHENTICATED_ONLY =
  'Authenticated to dev ([10.0.0.1]:22) using "publickey".\n';

/** The login line and, after it, the bootstrap's report that the session is ready for the commands. */
const AUTHENTICATED = `${AUTHENTICATED_ONLY}LAYER1-READY\n`;

/** A mux client's run: no login, its session line, then the same ready report. */
const MUX_SESSION =
  "debug1: auto-mux: Trying existing master at '/c'\n" +
  'debug1: mux_client_request_session: master session id: 3\nLAYER1-READY\n';

/** The failure of the extension's own connect wait (card connect-50). */
const TIMED_OUT = {kind: 'timeout', reason: {id: 'sshTimedOut'}} as const;

function requestFor(socksPort: number | undefined): SshRequest {
  return {
    purpose: 'connection',
    target: {host: 'dev'},
    settings: {
      configFile: '',
      connectTimeout: 10,
      permitPtyAllocation: undefined,
      remoteCommandInEffect: true,
    },
    effective: {
      hostName: 'dev',
      user: 'alex',
      port: '22',
      localForwards: [],
      clearAllForwardings: false,
    },
    programs: {sshProgram: 'ssh', scpProgram: 'scp'},
    homeFolder: '/home/a',
    platform: 'linux',
    ...(socksPort === undefined
      ? {clearUserForwards: true}
      : {forwards: [{kind: 'dynamic' as const, localPort: socksPort}]}),
  };
}

interface Fixture {
  clock: FakeClock;
  terminals: RecordingTerminals;
  questions: string[];
  questionsDisposed: number;
  runners: SessionRunner[];
  dependencies: TerminalConnectionDependencies;
  logged(): string[];
  open(cancellation?: AbortSignal): Promise<StepResult<ConnectionLease>>;
}

function fixture(
  options: {
    dynamic?: boolean;
    reveal?: boolean;
    name?: LoginTerminalName;
    timeoutSeconds?: number;
    fromHost?: boolean;
    level?: Level;
  } = {},
): Fixture {
  const {
    dynamic = false,
    reveal = false,
    name = 'install',
    timeoutSeconds = 10,
    fromHost = false,
    level = 'info',
  } = options;
  const clock = new FakeClock();
  const terminals = new RecordingTerminals();
  const sink = new MemorySink();
  const made: Fixture = {
    clock,
    logged: () => sink.lines.map(line => line.message),
    terminals,
    questions: [],
    questionsDisposed: 0,
    runners: [],
    dependencies: undefined as never,
    open: cancellation =>
      openTerminalConnectionStep(made.dependencies)(
        INPUT,
        TERMS,
        cancellation ?? new AbortController().signal,
      ),
  };
  let markers = 0;
  made.dependencies = {
    terminals,
    installRequest: (input, terms, socksPort) => requestFor(socksPort),
    dynamicForwarding: () => dynamic,
    freePort: () => Promise.resolve(41000),
    scheduler: clock.scheduler(),
    newMarker: () => {
      markers += 1;
      return `m${String(markers)}`;
    },
    channelFor: runner => {
      made.runners.push(runner);
      return CHANNEL;
    },
    attachQuestions: () => ({
      onQuestion: text => {
        made.questions.push(text);
      },
      dispose: () => {
        made.questionsDisposed += 1;
      },
    }),
    revealLoginTerminals: () => reveal,
    terminalName: () => name,
    connectWait: () => ({
      connectTimeoutSeconds: timeoutSeconds,
      fromHost,
      unboundedWaitSeconds: 600,
    }),
    logger: createLogger(sink, {minimumLevel: (): Level => level}),
  };
  return made;
}

async function settled(): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await Promise.resolve();
  }
}

/** Opens the step, lets it start its terminal, and gives the terminal. */
async function started(made: Fixture, cancellation?: AbortSignal) {
  const result = made.open(cancellation);
  await settled();
  const [terminal] = made.terminals.opened;
  if (terminal === undefined) {
    throw new Error('no terminal was opened');
  }
  return {result, terminal};
}

/** Logs in: the terminal says the user is authenticated, and the step hands over its lease. */
async function loggedIn(made: Fixture) {
  const {result, terminal} = await started(made);
  terminal.write(AUTHENTICATED);
  const outcome = await result;
  if (outcome.kind !== 'done') {
    throw new Error('the login did not hand over');
  }
  return {lease: outcome.value, terminal};
}

describe('the connection in terminal mode (card connect-17 table)', () => {
  /** The `[ssh]` lines the step logged. */
  function sshLogged(made: Fixture): string[] {
    return made.logged().filter(line => line.startsWith('[ssh] '));
  }

  it('F-2003 BR-6 item 6: terminal mode logs ssh’s lines up to its authentication as [ssh], once each, and not the bootstrap’s echo or the shell after it', async () => {
    const made = fixture({level: 'trace'});
    const {result, terminal} = await started(made);
    terminal.write('debug1: connecting\nWarning: Permanently added h\n');
    terminal.write(AUTHENTICATED_ONLY);
    terminal.write("printf 'LAYER1-READY\\n'\nexec sh\n");
    terminal.write('LAYER1-READY\n');
    await result;
    terminal.write('output of a script\n');
    deepStrictEqual(sshLogged(made), [
      '[ssh] debug1: connecting',
      '[ssh] Warning: Permanently added h',
      '[ssh] Authenticated to dev ([10.0.0.1]:22) using "publickey".',
    ]);
  });

  it('F-2003 BR-8: after authentication terminal mode logs only ssh’s own channel and forward lines, from a mixed pty buffer, before and after the hand-over', async () => {
    const made = fixture({level: 'trace'});
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED_ONLY);
    terminal.write(
      "printf 'LAYER1-READY\\n'\nexec sh\nls -l\ntotal 4\nchannel 3: open failed: administratively prohibited: open failed\nconnect_to localhost port 8080: failed.\nWarning: remote port forwarding failed for listen port 9000\nLAYER1-READY\n",
    );
    await result;
    terminal.write(
      'a line of the shell\nchannel 4: open failed: connect failed: Connection refused\n',
    );
    deepStrictEqual(sshLogged(made), [
      '[ssh] Authenticated to dev ([10.0.0.1]:22) using "publickey".',
      '[ssh] channel 3: open failed: administratively prohibited: open failed',
      '[ssh] connect_to localhost port 8080: failed.',
      '[ssh] Warning: remote port forwarding failed for listen port 9000',
      '[ssh] channel 4: open failed: connect failed: Connection refused',
    ]);
  });

  it('F-2003 BR-8: at debug terminal mode keeps the lines without debug1, and the failing login’s refusal is among them', async () => {
    const made = fixture({level: 'info'});
    const {result, terminal} = await started(made);
    terminal.write('debug1: connecting\n');
    terminal.write('ssh: connect to host dev port 22: Connection refused\n');
    terminal.end(255, 'process');
    await result;
    deepStrictEqual(sshLogged(made), [
      '[ssh] ssh: connect to host dev port 22: Connection refused',
    ]);
  });

  it('F-2308 3.2: opens one terminal named install, revealed as the setting says', async () => {
    const made = fixture({reveal: true});
    const {terminal} = await started(made);
    deepStrictEqual(
      [made.terminals.opened.length, terminal.name, terminal.revealedAtOpen],
      [1, 'install', true],
    );
  });

  it('connect-113, F-2308 AC-19: the terminal is opened with the name the dependencies give', async () => {
    const made = fixture({name: 'Uninstall VS Code Server'});
    const {terminal} = await started(made);
    deepStrictEqual(terminal.name, 'Uninstall VS Code Server');
  });

  it('F-2410 AC-32: with the login terminal setting off the install terminal is opened hidden and a password question never reveals it', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    terminal.write("alex@dev's password: ");
    made.clock.advance(100);
    deepStrictEqual(
      [terminal.revealedAtOpen, terminal.revealCount, made.questions.length],
      [false, 0, 1],
    );
  });

  it('F-2101 AC-30: the connection in terminal mode adds no variable to the editor environment, so no SSH_ASKPASS', async () => {
    const {terminal} = await started(fixture());
    deepStrictEqual(terminal.invocation.environment, {});
  });

  it('F-2704 BR-1, F-2107 BR-1: with a RemoteCommand in effect the invocation has no program after the host, and no terminal on the host', async () => {
    const {terminal} = await started(fixture());
    const invoked = terminal.invocation.arguments;
    deepStrictEqual(
      [invoked.slice(-2), invoked.includes('-T')],
      [['--', 'dev'], true],
    );
  });

  it('F-2107 BR-1: with a RemoteCommand in effect the first bytes the session is fed are the exec line of the bootstrap program', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    terminal.write(AUTHENTICATED_ONLY);
    await settled();
    deepStrictEqual(terminal.sent[0]?.startsWith('exec sh -c '), true);
  });

  it('F-2104 6.3: with dynamic forwarding the install holds the SOCKS port', async () => {
    const {terminal} = await started(fixture({dynamic: true}));
    const invoked = terminal.invocation.arguments;
    deepStrictEqual(invoked[invoked.indexOf('-D') + 1], '127.0.0.1:41000');
  });

  it('F-2104 6.3: with dynamic forwarding the lease carries that port', async () => {
    const made = fixture({dynamic: true});
    const {result, terminal} = await started(made);
    terminal.write(`debug1: x\n${AUTHENTICATED}`);
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'done' ? outcome.value.socksPort : undefined,
      41000,
    );
  });

  it('F-2104 6.2 step 1: without dynamic forwarding the user forwards are cleared', async () => {
    const {terminal} = await started(fixture({dynamic: false}));
    const invoked = terminal.invocation.arguments;
    deepStrictEqual(
      [invoked.includes('ClearAllForwardings=yes'), invoked.includes('-D')],
      [true, false],
    );
  });

  it('#299: the authenticated line ends the login with a lease', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(`debug1: x\n${AUTHENTICATED}`);
    deepStrictEqual((await result).kind, 'done');
  });

  it("F-2102 AC-26: a mux client's session line starts the session, as a login's would", async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(MUX_SESSION);
    deepStrictEqual((await result).kind, 'done');
  });

  it('connect-108, F-2308 AC-2: with the login terminal shown no questions are attached, so a password question opens no input', async () => {
    const made = fixture({reveal: true});
    const {result, terminal} = await started(made);
    terminal.write("alex@dev's password: ");
    made.clock.advance(100);
    terminal.write(`\n${AUTHENTICATED}`);
    await result;
    deepStrictEqual([made.questions, made.questionsDisposed], [[], 0]);
  });

  it('connect-108: with the login terminal shown a question nobody can reach after the handshake still times out', async () => {
    deepStrictEqual((await unreachable(true)).outcome, {
      kind: 'failed',
      failure: TIMED_OUT,
    });
  });

  it('athena on #352: a question the reader reports reaches the questions', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    terminal.write("alex@dev's password: ");
    made.clock.advance(100);
    deepStrictEqual(made.questions, ["alex@dev's password: "]);
  });

  it('ADR-0010: the prompt reader after login: noise around and inside its stream changes nothing', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    terminal.write(`${NOISE_LINES.join('\n')}\n`);
    terminal.write('Password: ');
    made.clock.advance(100);
    terminal.write('\nAre you sure you want to continue connecting (yes/no)? ');
    made.clock.advance(100);
    deepStrictEqual(made.questions, []);
  });

  it('F-2308 7.E7: an end with no output and no code is a refused trust', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.end(undefined, 'process');
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {kind: 'cancelled', reason: {id: 'trustRefused'}},
    });
  });

  it('F-2308 7.E7: a terminal the user closed before any output was not a refused trust', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.end(undefined, 'user');
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.reason : outcome,
      classify([], undefined, 'connection', 'terminal').reason,
    );
  });

  it('connect-64: a failed terminal login keeps its exit code for the log', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write('ssh: connect to host dev port 22: Connection refused\n');
    terminal.end(255, 'process');
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.sshExitStatus : outcome,
      255,
    );
  });

  it('#299: another end is classified in terminal mode', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    const lines = [
      'ssh: Could not resolve hostname dev: Name or service not known',
    ];
    terminal.write(`${lines.join('\n')}\n`);
    terminal.end(255, 'process');
    const expected = classify(lines, 255, 'connection', 'terminal');
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'failed'
        ? [outcome.failure.kind, outcome.failure.reason]
        : outcome,
      [expected.kind, expected.reason],
    );
  });

  /** A login that reached the handshake and then asked a question nobody recognises, until its bound has passed. */
  async function unreachable(reveal = false) {
    const made = fixture({timeoutSeconds: 10, reveal});
    const {result, terminal} = await started(made);
    terminal.write('debug1: SSH2_MSG_NEWKEYS received\n');
    terminal.write('Some unknown question? ');
    made.clock.advance(12_000);
    return {outcome: await result, terminal};
  }

  /** `true` when the step has not settled by the time the microtasks drain. */
  async function notSettled(
    result: Promise<StepResult<ConnectionLease>>,
  ): Promise<boolean> {
    const which = await Promise.race([
      result.then(() => 'settled'),
      settled().then(() => 'still-open'),
    ]);
    return which === 'still-open';
  }

  it('F-2308 BR-5: a question nobody can reach after the handshake times out', async () => {
    deepStrictEqual((await unreachable()).outcome, {
      kind: 'failed',
      failure: TIMED_OUT,
    });
  });

  it('F-2308 BR-5: the terminal is disposed when the question is unreachable', async () => {
    deepStrictEqual((await unreachable()).terminal.disposed, true);
  });

  it('athena on #385: an open question is not failed 11 999 ms after the handshake', async () => {
    const made = fixture({timeoutSeconds: 10});
    const {result, terminal} = await started(made);
    terminal.write('debug1: SSH2_MSG_NEWKEYS received\n');
    terminal.write('Some unknown question? ');
    made.clock.advance(11_999);
    deepStrictEqual(await notSettled(result), true);
  });

  it('athena on #385: the setting 0 no longer fails an open question at once', async () => {
    const made = fixture({timeoutSeconds: 0});
    const {result, terminal} = await started(made);
    terminal.write('debug1: SSH2_MSG_NEWKEYS received\n');
    terminal.write('Some unknown question? ');
    made.clock.advance(1);
    deepStrictEqual(await notSettled(result), true);
  });

  it('athena on #385: a host 0 fails the open question at the ceiling', async () => {
    const made = fixture({timeoutSeconds: 0, fromHost: true});
    const {result, terminal} = await started(made);
    terminal.write('debug1: SSH2_MSG_NEWKEYS received\n');
    terminal.write('Some unknown question? ');
    made.clock.advance(600_000);
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: TIMED_OUT,
    });
  });

  it('F-2105 BR-3: no output for the connect wait is a timeout', async () => {
    const made = fixture({timeoutSeconds: 10});
    const {result} = await started(made);
    made.clock.advance(12_000);
    deepStrictEqual(await result, {kind: 'failed', failure: TIMED_OUT});
  });

  it('ruling 4: the first output stops the wait', async () => {
    const made = fixture({timeoutSeconds: 10});
    const {result, terminal} = await started(made);
    terminal.write('debug1: first output\n');
    made.clock.advance(60_000);
    terminal.write(AUTHENTICATED);
    deepStrictEqual((await result).kind, 'done');
  });

  it('contracts: a cancellation during the login cancels the connect', async () => {
    const made = fixture();
    const controller = new AbortController();
    const {result} = await started(made, controller.signal);
    controller.abort();
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {kind: 'cancelled'},
    });
  });

  it('contracts: a cancellation disposes the terminal', async () => {
    const made = fixture();
    const controller = new AbortController();
    const {result, terminal} = await started(made, controller.signal);
    controller.abort();
    await result;
    deepStrictEqual(terminal.disposed, true);
  });

  it('F-2410 BR-5: the lease stores no shared record', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'done'
        ? await outcome.value.storeSharedRecord(RECORD)
        : undefined,
      false,
    );
  });

  it('F-2410 BR-5, F-2311 R2: the lease finds no stored record, so each window plans fresh', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'done' ? outcome.value.storedRecord : outcome,
      undefined,
    );
  });

  /** The notices a lease hears while the terminal ends twice, when `unsubscribe` is set after the subscription. */
  async function noticesAtEnd(
    unsubscribe: boolean,
  ): Promise<ConnectionNotice[]> {
    const {lease, terminal} = await loggedIn(fixture());
    const heard: ConnectionNotice[] = [];
    const stop = lease.onNotice(notice => heard.push(notice));
    if (unsubscribe) {
      stop();
    }
    terminal.end(0, 'process');
    terminal.end(0, 'process');
    return heard;
  }

  it('F-2308 BR-7: the end of the terminal after the handover tells the lease once', async () => {
    deepStrictEqual(await noticesAtEnd(false), [{type: 'transportLost'}]);
  });

  it('F-2308 BR-7: a listener that unsubscribed is not told when the terminal ends', async () => {
    deepStrictEqual(await noticesAtEnd(true), []);
  });

  it('contracts: releasing twice disposes the terminal once', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    const outcome = await result;
    const ends: string[] = [];
    const [session] = [terminal];
    if (outcome.kind === 'done') {
      outcome.value.release();
      outcome.value.release();
    }
    ends.push(String(session.disposed));
    deepStrictEqual([ends, made.terminals.opened.length], [['true'], 1]);
  });

  it('contract S10: the lease channel runs scripts over the terminal', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    await result;
    const [runner] = made.runners;
    void runner?.runOnSession(
      {
        script: 'echo hi',
        environment: {},
        inputBase64: null,
        deadlineMilliseconds: 1000,
      },
      () => undefined,
      5000,
    );
    deepStrictEqual(terminal.sent.length, 2);
  });

  it('card ssh-38: the authenticated line alone does not hand over: the lease waits for the ready line', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    let handedOver = false;
    void result.then(() => {
      handedOver = true;
    });
    terminal.write(AUTHENTICATED_ONLY);
    await settled();
    deepStrictEqual(handedOver, false);
  });

  it('card ssh-38: the ready line after the login hands over the lease', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED_ONLY);
    terminal.write('LAYER1-READY\n');
    deepStrictEqual((await result).kind, 'done');
  });

  it('F-2704 AC-11: a login shell that outlasted its bound fails the connect as a timeout, and is logged', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(`${AUTHENTICATED_ONLY}LAYER1-TIMEOUT 10\n`);
    deepStrictEqual(await result, {kind: 'failed', failure: TIMED_OUT});
  });

  it("F-2704 AC-13: a login shell that ended by itself fails the connect with no reason of ssh's", async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(`${AUTHENTICATED_ONLY}LAYER1-EXITED 1\n`);
    deepStrictEqual(await result, {kind: 'failed', failure: {kind: 'unknown'}});
  });

  it('F-2704 AC-11: the wait still runs after the login line, so a session that stays silent times out', async () => {
    const made = fixture({timeoutSeconds: 10});
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED_ONLY);
    made.clock.advance(13_000);
    deepStrictEqual(await result, {kind: 'failed', failure: TIMED_OUT});
  });

  it("F-2105 7.E3: in terminal mode, the wait, the prompt reader and the bootstrap's timeout give the same reason", async () => {
    const waited = fixture({timeoutSeconds: 10});
    const silent = await started(waited);
    waited.clock.advance(12_000);
    const booted = fixture();
    const outlasted = await started(booted);
    outlasted.terminal.write(`${AUTHENTICATED_ONLY}LAYER1-TIMEOUT 10\n`);
    deepStrictEqual(
      [
        await silent.result,
        (await unreachable()).outcome,
        await outlasted.result,
      ].map(outcome => (outcome.kind === 'failed' ? outcome.failure : outcome)),
      [TIMED_OUT, TIMED_OUT, TIMED_OUT],
    );
  });

  it("F-2105 BR-3: the terminal session's login shell is bounded at the connect wait", async () => {
    const made = fixture({timeoutSeconds: 10, fromHost: true});
    const {terminal} = await started(made);
    terminal.write(AUTHENTICATED_ONLY);
    await settled();
    deepStrictEqual(
      terminal.sent
        .flatMap(text => text.split('\n'))
        .find(line => line.startsWith('LAYER1_SECONDS=')),
      'LAYER1_SECONDS=12',
    );
  });

  it('contracts: the questions are taken down at the handover', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    await result;
    deepStrictEqual(made.questionsDisposed, 1);
  });

  it('contracts: the questions are taken down when the login fails', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.end(255, 'process');
    await result;
    deepStrictEqual(made.questionsDisposed, 1);
  });

  it('contracts: a cancellation that came before the terminal opened opens none', async () => {
    const made = fixture({dynamic: true});
    const controller = new AbortController();
    const result = made.open(controller.signal);
    controller.abort();
    deepStrictEqual(
      [await result, made.terminals.opened.length],
      [{kind: 'failed', failure: {kind: 'cancelled'}}, 0],
    );
  });

  it('contracts: a channel that cannot be made fails the connect and ends the terminal', async () => {
    const made = fixture();
    made.dependencies.channelFor = () => {
      throw new Error('no channel');
    };
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    deepStrictEqual(
      [await result, terminal.disposed],
      [
        {
          kind: 'failed',
          failure: {kind: 'unknown', logDetail: 'Error: no channel'},
        },
        true,
      ],
    );
  });

  it('contracts: output after the login has settled is ignored', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.end(255, 'process');
    await result;
    terminal.write('late output\n');
    deepStrictEqual(made.questions, []);
  });

  it('contracts: a lease answers and refuses nothing, since no notice carries a question', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(AUTHENTICATED);
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'done'
        ? [await outcome.value.answer(1, 'x'), await outcome.value.refuse(1)]
        : outcome,
      [false, false],
    );
  });

  it("ADR-0010: a terminal that ends after authentication is not classified from the shell's output", async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(`${AUTHENTICATED_ONLY}x@h: Permission denied (fridge).\n`);
    terminal.end(255, 'process');
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.kind : outcome,
      'unknown',
    );
  });
});
