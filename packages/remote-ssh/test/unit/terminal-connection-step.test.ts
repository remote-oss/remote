import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import type {HostChannel} from 'lib-host';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  classify,
  type ConnectionNotice,
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

const AUTHENTICATED =
  'Authenticated to dev ([10.0.0.1]:22) using "publickey".\n';

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
    remoteProgram: 'sh',
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
  open(cancellation?: AbortSignal): Promise<StepResult<ConnectionLease>>;
}

function fixture(
  options: {dynamic?: boolean; reveal?: boolean; timeoutSeconds?: number} = {},
): Fixture {
  const {dynamic = false, reveal = false, timeoutSeconds = 10} = options;
  const clock = new FakeClock();
  const terminals = new RecordingTerminals();
  const made: Fixture = {
    clock,
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
    connectWait: () => ({
      connectTimeoutSeconds: timeoutSeconds,
      fromHost: false,
      unboundedWaitSeconds: 600,
    }),
    logger: createLogger(new MemorySink(), {minimumLevel: (): Level => 'info'}),
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
  it('F-2308 3.2: opens one terminal named install, revealed as the setting says', async () => {
    const made = fixture({reveal: true});
    const {terminal} = await started(made);
    deepStrictEqual(
      [made.terminals.opened.length, terminal.name, terminal.revealedAtOpen],
      [1, 'install', true],
    );
  });

  it('F-2704 BR-1: the invocation runs sh without a terminal on the host', async () => {
    const {terminal} = await started(fixture());
    const invoked = terminal.invocation.arguments;
    deepStrictEqual(
      [invoked.slice(-3), invoked.includes('-T')],
      [['--', 'dev', 'sh'], true],
    );
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

  it('athena on #352: a question the reader reports reaches the questions', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    terminal.write("alex@dev's password: ");
    made.clock.advance(100);
    deepStrictEqual(made.questions, ["alex@dev's password: "]);
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
  async function unreachable() {
    const made = fixture({timeoutSeconds: 10});
    const {result, terminal} = await started(made);
    terminal.write('debug1: SSH2_MSG_NEWKEYS received\n');
    terminal.write('Some unknown question? ');
    made.clock.advance(10_000);
    return {outcome: await result, terminal};
  }

  it('F-2308 BR-5: a question nobody can reach after the handshake times out', async () => {
    deepStrictEqual((await unreachable()).outcome, {
      kind: 'failed',
      failure: {kind: 'timeout'},
    });
  });

  it('F-2308 BR-5: the terminal is disposed when the question is unreachable', async () => {
    deepStrictEqual((await unreachable()).terminal.disposed, true);
  });

  it('F-2105 BR-3: no output for the connect wait is a timeout', async () => {
    const made = fixture({timeoutSeconds: 10});
    const {result} = await started(made);
    made.clock.advance(12_000);
    deepStrictEqual(await result, {kind: 'failed', failure: {kind: 'timeout'}});
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
      {script: 'echo hi', inputBase64: null, deadlineMilliseconds: 1000},
      () => undefined,
      5000,
    );
    deepStrictEqual(terminal.sent.length, 1);
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
          failure: {kind: 'unknown', reason: {text: 'Error: no channel'}},
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
});
