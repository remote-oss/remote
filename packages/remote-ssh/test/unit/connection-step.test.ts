import {deepStrictEqual} from 'node:assert';
import type {HostChannel} from 'lib-host';
import type {HelperLease, PlainData} from 'lib-helper';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type ConnectionAcquireRequest,
  type ConnectionNotice,
  type RunFacts,
  SharedConnection,
} from 'lib-ssh';
import {
  type LoginLease,
  openConnectionStep,
} from '../../src/pipeline/connection-step.ts';
import type {PhaseEvent} from '../../src/pipeline/connect.ts';
import type {
  ConnectInput,
  ConnectionTerms,
  StepFailure,
} from '../../src/pipeline/steps.ts';

const INPUT: ConnectInput = {
  target: {kind: 'plain', text: 'harness'},
  rawHostString: 'harness',
  attempt: 1,
  isReconnection: false,
  windowId: 'window-1',
  windowWorkspace: undefined,
};

const TERMS: ConnectionTerms = {
  platform: 'linux',
  remoteCommandInEffect: true,
};

const LIMITS = {requestMilliseconds: 5000, loginMilliseconds: 60000};

const RUN_FACTS = {
  sshProgram: 'ssh',
  scpProgram: 'scp',
  effective: {
    hostName: 'harness',
    user: 'dev',
    port: '22',
    localForwards: [],
    clearAllForwardings: false,
  },
};

const WAITS = {probeMilliseconds: 7000, tunnelMilliseconds: 8000};

/** A lease that answers requests from a script and lets a test send the helper's events. */
class FakeLease {
  readonly leaseId = 1;
  readonly payload = {
    socksPort: 41000,
    runFacts: JSON.stringify(RUN_FACTS),
  };
  released = 0;
  readonly asked: PlainData[] = [];
  /** What the helper answers to the first requests to connect, in order; it accepts after these. */
  connectReplies: PlainData[] = [];
  /** The record an earlier window left, which the helper gives back when asked; none when unset. */
  storedRecord: PlainData | undefined;
  private readonly listeners: Array<(event: unknown) => void> = [];

  onEvent(listener: (event: unknown) => void): void {
    this.listeners.push(listener);
  }

  request(body: PlainData): Promise<unknown> {
    this.asked.push(body);
    const type = (body as {type: string}).type;
    const reply =
      type === 'connect'
        ? (this.connectReplies.shift() ?? {type: 'accepted'})
        : type === 'sharedRecord' && this.storedRecord !== undefined
          ? {type: 'sharedRecord', record: this.storedRecord}
          : {type: 'accepted'};
    return Promise.resolve({kind: 'reply', body: reply});
  }

  release(): void {
    this.released += 1;
  }

  emit(body: PlainData): void {
    for (const listener of this.listeners) {
      listener({kind: 'message', body});
    }
  }
}

async function settled(): Promise<void> {
  for (let round = 0; round < 20; round++) {
    await Promise.resolve();
  }
}

const CHANNEL = {identity: () => 'harness'} as unknown as HostChannel;

interface Fixture {
  lease: FakeLease;
  requests: Array<ConnectionAcquireRequest<StepFailure>>;
  adopted: RunFacts[];
  notices: ConnectionNotice[];
  logins: {attached: number; disposed: number; inputs: ConnectInput[]};
  login: LoginLease | undefined;
  logged: () => string[];
  phases: PhaseEvent[];
  channelsFor: unknown[];
  termsAsked: ConnectionTerms[];
  connecting: (
    cancellation?: AbortSignal,
    input?: ConnectInput,
  ) => ReturnType<ReturnType<typeof openConnectionStep>>;
}

function fixture(
  acquired:
    | 'acquired'
    | 'spawnFailed'
    | 'endpointUnreachable'
    | 'cancelled' = 'acquired',
  channelFailureMessage?: string,
): Fixture {
  const lease = new FakeLease();
  const requests: Array<ConnectionAcquireRequest<StepFailure>> = [];
  const adopted: RunFacts[] = [];
  const notices: ConnectionNotice[] = [];
  const logins: Fixture['logins'] = {attached: 0, disposed: 0, inputs: []};
  const held: {login?: LoginLease} = {};
  const sink = new MemorySink();
  const channelsFor: unknown[] = [];
  const termsAsked: ConnectionTerms[] = [];
  const phases: PhaseEvent[] = [];
  const step = openConnectionStep({
    onPhase: event => {
      phases.push(event);
    },
    acquire: request => {
      requests.push(request);
      return Promise.resolve(
        acquired === 'acquired'
          ? {
              kind: 'acquired',
              connection: new SharedConnection(
                lease as unknown as HelperLease,
                () => LIMITS,
                () => () => undefined,
              ),
            }
          : {kind: 'failed', failure: acquired},
      );
    },
    adoptRunFacts: runFacts => {
      adopted.push(runFacts);
    },
    waits: () => WAITS,
    requestFor: (input, terms) => {
      termsAsked.push(terms);
      return {
        folder: '/registry',
        script: '/ext/helper.js',
        prepare: () =>
          Promise.resolve({
            kind: 'ready' as const,
            runFacts: RUN_FACTS,
            options: {
              request: JSON.stringify({
                remoteCommand: terms.remoteCommandInEffect,
              }),
              unboundedWaitSeconds: 120,
              runtimeFolder: '/run',
              runtime: '/editor',
              askpassProgram: '/ext/askpass.js',
              displayHost: 'harness',
              externalAskpass: false,
              askpassFirstMessageMilliseconds: 5000,
            },
          }),
        policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
      };
    },
    channelFor: (connection, terms, input) => {
      if (channelFailureMessage !== undefined) {
        throw new Error(channelFailureMessage);
      }
      channelsFor.push([
        connection instanceof SharedConnection,
        terms,
        input.rawHostString,
      ]);
      return CHANNEL;
    },
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
    attachLogin: (login, input) => {
      logins.attached += 1;
      logins.inputs.push(input);
      held.login = login;
      const stop = login.onNotice(notice => {
        notices.push(notice);
      });
      return {
        dispose: () => {
          logins.disposed += 1;
          stop();
        },
      };
    },
  });
  return {
    lease,
    requests,
    adopted,
    notices,
    logins,
    logged: () => sink.lines.map(line => line.message),
    phases,
    get login() {
      return held.login;
    },
    channelsFor,
    termsAsked,
    connecting: (cancellation, input) =>
      step(input ?? INPUT, TERMS, cancellation ?? new AbortController().signal),
  };
}

/** A fixture whose connect has gone through the login, with what the connect gave. */
async function loggedIn(
  storedRecord?: PlainData,
): Promise<Fixture & {outcome: Awaited<ReturnType<Fixture['connecting']>>}> {
  const ready = fixture();
  ready.lease.storedRecord = storedRecord;
  const pending = ready.connecting();
  await settled();
  ready.lease.emit({type: 'connected', socksPort: 41000});
  return {...ready, outcome: await pending};
}

describe('the connection step', () => {
  it('asks for the helper of the host string as written, with the connect cancellation', async () => {
    const {requests, connecting} = fixture();
    const controller = new AbortController();
    void connecting(controller.signal);
    await settled();
    deepStrictEqual(
      [
        requests[0]?.hostString,
        requests[0]?.cancellation === controller.signal,
      ],
      ['harness', true],
    );
  });

  it('F-2411.BR-2: the acquire is keyed by the connection key when the input names one', async () => {
    const {requests, connecting} = fixture();
    void connecting(undefined, {...INPUT, connectionKey: 'x'});
    await settled();
    deepStrictEqual(requests[0]?.hostString, 'x');
  });

  it('gives the pipeline the channel for the connection that is set up, once the login is done', async () => {
    const {channelsFor, outcome} = await loggedIn();
    deepStrictEqual(
      [
        outcome.kind === 'done' ? outcome.value.channel === CHANNEL : outcome,
        channelsFor,
      ],
      [true, [[true, TERMS, 'harness']]],
    );
  });

  it('builds the request of the acquire from the terms of the connect', async () => {
    const {requests, connecting, termsAsked} = fixture();
    void connecting();
    await settled();
    const prepared = await requests[0]?.prepare();
    deepStrictEqual(
      [termsAsked, prepared?.kind === 'ready' && prepared.options.request],
      [[TERMS], '{"remoteCommand":true}'],
    );
  });

  it('gives the pipeline the SOCKS port of the connection', async () => {
    const {outcome} = await loggedIn();
    deepStrictEqual(
      outcome.kind === 'done' ? outcome.value.socksPort : outcome,
      41000,
    );
  });

  it('F-2311 R2: gives the pipeline no stored record when the helper holds none', async () => {
    const {outcome} = await loggedIn();
    deepStrictEqual(
      outcome.kind === 'done' ? outcome.value.storedRecord : outcome,
      undefined,
    );
  });

  it('F-2311 R2: gives the pipeline the record an earlier window left, with its plans', async () => {
    const record = {
      remotePort: 4321,
      operatingSystem: 'linux',
      architecture: 'x64',
      temporaryFolder: '/tmp',
      connectionToken: 'token',
      agentLink: {kind: 'none', reason: 'noForwardedSocket'},
      display: {kind: 'display', value: 'localhost:10.0'},
    };
    const {outcome} = await loggedIn(record);
    deepStrictEqual(
      outcome.kind === 'done' ? outcome.value.storedRecord : outcome,
      record,
    );
  });

  it('leaves the shared record with the helper when the pipeline asks', async () => {
    const {lease, outcome} = await loggedIn();
    const record = {
      remotePort: 4321,
      operatingSystem: 'linux' as const,
      architecture: 'x64' as const,
      temporaryFolder: '/tmp',
      connectionToken: 'token',
    };
    const stored =
      outcome.kind === 'done'
        ? await outcome.value.storeSharedRecord(record)
        : outcome;
    deepStrictEqual(
      [stored, lease.asked.at(-1)],
      [true, {type: 'setSharedRecord', record}],
    );
  });

  it('keeps the lease until the pipeline gives it back, and then gives it back once', async () => {
    const {lease, outcome} = await loggedIn();
    const heldBefore = lease.released;
    if (outcome.kind === 'done') {
      outcome.value.release();
    }
    deepStrictEqual([heldBefore, lease.released], [0, 1]);
  });

  it('tells the window the questions of the login while it waits', async () => {
    const {lease, connecting, notices} = fixture();
    const pending = connecting();
    await settled();
    lease.emit({
      type: 'prompt',
      promptId: 3,
      surface: 'maskedInput',
      text: "alex@harness's password: ",
    });
    lease.emit({type: 'connected', socksPort: 41000});
    await pending;
    deepStrictEqual(notices, [
      {type: 'loginStarted'},
      {
        type: 'prompt',
        promptId: 3,
        surface: 'maskedInput',
        text: "alex@harness's password: ",
      },
    ]);
  });

  it('connect-14: takes the questions down once the login is done, before the lease is given back', async () => {
    const {lease, notices} = await loggedIn();
    lease.emit({type: 'waitingForOtherWindow'});
    deepStrictEqual(notices, [{type: 'loginStarted'}]);
  });

  it('F-2102 5.2 step 3: a login another window holds is shown as the waiting stage', async () => {
    const {lease, connecting, phases} = fixture();
    void connecting();
    await settled();
    lease.emit({type: 'waitingForOtherWindow'});
    deepStrictEqual(phases, [
      {kind: 'initializing'},
      {kind: 'waitingForOtherWindow'},
    ]);
  });

  it('F-2102 5.3 step 4: when the login falls to this window the stage is initializing again', async () => {
    const ready = fixture();
    ready.lease.connectReplies = [
      {type: 'refused', reason: 'alreadyConnecting'},
    ];
    void ready.connecting();
    await settled();
    ready.lease.emit({type: 'ownerChanged', owner: ready.lease.leaseId});
    await settled();
    deepStrictEqual(ready.phases, [
      {kind: 'waitingForOtherWindow'},
      {kind: 'initializing'},
    ]);
  });

  it('contracts: a notice after the login ended reports no stage', async () => {
    const {lease, phases} = await loggedIn();
    lease.emit({type: 'waitingForOtherWindow'});
    deepStrictEqual(phases, [{kind: 'initializing'}]);
  });

  it('F-2304 6.1: a lease on a helper already connected reports no stage', async () => {
    const ready = fixture();
    ready.lease.connectReplies = [
      {type: 'refused', reason: 'alreadyConnected'},
    ];
    void ready.connecting();
    await settled();
    deepStrictEqual(ready.phases, []);
  });

  it('F-2304 BR-11: a login this window starts is the initializing stage', async () => {
    const {phases} = await loggedIn();
    deepStrictEqual(phases, [{kind: 'initializing'}]);
  });

  it('connect-14: shows the questions from the acquire, once, for this connect', async () => {
    const {logins} = await loggedIn();
    deepStrictEqual([logins.attached, logins.inputs], [1, [INPUT]]);
  });

  it('connect-14: takes the questions down once the login is done', async () => {
    const {logins} = await loggedIn();
    deepStrictEqual(logins.disposed, 1);
  });

  it('connect-14: takes the questions down when the login fails', async () => {
    const {lease, connecting, logins} = fixture();
    const pending = connecting();
    await settled();
    lease.emit({
      type: 'loginFailed',
      kind: 'authentication',
      reason: {text: 'Permission denied (publickey).'},
      hints: [],
    });
    await pending;
    deepStrictEqual(logins.disposed, 1);
  });

  it('connect-14: takes the questions down when the connect is cancelled during the login', async () => {
    const {connecting, logins} = fixture();
    const controller = new AbortController();
    const pending = connecting(controller.signal);
    await settled();
    controller.abort();
    await pending;
    deepStrictEqual(logins.disposed, 1);
  });

  it('connect-14: shows no questions when no lease could be taken', async () => {
    const {connecting, logins} = fixture('spawnFailed');
    await connecting();
    deepStrictEqual(logins.attached, 0);
  });

  it('connect-14: the window answers a question of the login through the connection', async () => {
    const ready = fixture();
    const pending = ready.connecting();
    await settled();
    await ready.login?.answer(3, 'secret');
    ready.lease.emit({type: 'connected', socksPort: 41000});
    await pending;
    deepStrictEqual(ready.lease.asked.at(-2), {
      type: 'answer',
      promptId: 3,
      text: 'secret',
    });
  });

  it('connect-14: the window refuses a question of the login through the connection', async () => {
    const ready = fixture();
    const pending = ready.connecting();
    await settled();
    await ready.login?.refuse(3);
    ready.lease.emit({type: 'connected', socksPort: 41000});
    await pending;
    deepStrictEqual(ready.lease.asked.at(-2), {type: 'refuse', promptId: 3});
  });

  it('fails with the kind, reason and hints of a login that failed, and gives the lease back', async () => {
    const {lease, connecting} = fixture();
    const pending = connecting();
    await settled();
    lease.emit({
      type: 'loginFailed',
      kind: 'authentication',
      reason: {text: 'Permission denied (publickey).'},
      hints: [],
    });
    deepStrictEqual(
      [await pending, lease.released],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'authentication',
            reason: {text: 'Permission denied (publickey).'},
            hints: [],
          },
        },
        1,
      ],
    );
  });

  it('fails as cancelled and gives the lease back when the connect is cancelled while it waits', async () => {
    const {lease, connecting} = fixture();
    const controller = new AbortController();
    const pending = connecting(controller.signal);
    await settled();
    controller.abort();
    deepStrictEqual(
      [await pending, lease.released],
      [{kind: 'failed', failure: {kind: 'cancelled'}}, 1],
    );
  });

  it('#253 Q10: a helper that cannot be reached fails with no reason of its own, not as a closed connection', async () => {
    const {connecting} = fixture('endpointUnreachable');
    deepStrictEqual(await connecting(), {
      kind: 'failed',
      failure: {kind: 'unknown'},
    });
  });

  it('#253 Q10: a helper that did not start fails with no reason of its own', async () => {
    const {connecting} = fixture('spawnFailed');
    deepStrictEqual(await connecting(), {
      kind: 'failed',
      failure: {kind: 'unknown'},
    });
  });

  it('F-2003: a cancelled acquire is no fault of the helper, and logs nothing', async () => {
    const {connecting, logged} = fixture('cancelled');
    await connecting();
    deepStrictEqual(logged(), []);
  });

  it('F-2003: the cause of a helper that cannot be reached is in the log', async () => {
    const {connecting, logged} = fixture('endpointUnreachable');
    await connecting();
    deepStrictEqual(logged(), [
      'the connection helper could not be reached or started: endpointUnreachable',
    ]);
  });

  it('gives the lease back when the channel for the connection cannot be opened', async () => {
    const {lease, connecting} = fixture('acquired', 'the channel is gone');
    const pending = connecting();
    await settled();
    lease.emit({type: 'connected', socksPort: 41000});
    deepStrictEqual(
      [await pending, lease.released],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'unknown',
            logDetail: 'Error: the channel is gone',
          },
        },
        1,
      ],
    );
  });

  it('lets the window hear the notices of the login through the lease, and stop with its unsubscribe', async () => {
    const {lease, outcome} = await loggedIn();
    if (outcome.kind !== 'done') {
      throw new Error('the connect should be done');
    }
    const heard: ConnectionNotice[] = [];
    const stop = outcome.value.onNotice(notice => heard.push(notice));
    lease.emit({
      type: 'prompt',
      promptId: 3,
      surface: 'maskedInput',
      text: "alex@harness's password: ",
    });
    stop();
    lease.emit({type: 'ownerChanged', owner: 1});
    deepStrictEqual(heard, [
      {
        type: 'prompt',
        promptId: 3,
        surface: 'maskedInput',
        text: "alex@harness's password: ",
      },
    ]);
  });

  it('passes the answer of the window to the connection, with its result', async () => {
    const {lease, outcome} = await loggedIn();
    if (outcome.kind !== 'done') {
      throw new Error('the connect should be done');
    }
    const answered = await outcome.value.answer(3, 'yes');
    deepStrictEqual(
      [answered, lease.asked.at(-1)],
      [false, {type: 'answer', promptId: 3, text: 'yes'}],
    );
  });

  it('passes the refusal of the window to the connection, with its result', async () => {
    const {lease, outcome} = await loggedIn();
    if (outcome.kind !== 'done') {
      throw new Error('the connect should be done');
    }
    const refused = await outcome.value.refuse(3);
    deepStrictEqual(
      [refused, lease.asked.at(-1)],
      [false, {type: 'refuse', promptId: 3}],
    );
  });
});
