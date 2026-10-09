import {deepStrictEqual} from 'node:assert';
import type {HostChannel} from 'lib-host';
import type {HelperLease, PlainData} from 'lib-helper';
import {
  type ConnectionAcquireRequest,
  type ConnectionNotice,
  SharedConnection,
} from 'lib-ssh';
import {openConnectionStep} from '../../src/pipeline/connection-step.ts';
import type {ConnectInput, ConnectionTerms} from '../../src/pipeline/steps.ts';

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

/** A lease that answers requests from a script and lets a test send the helper's events. */
class FakeLease {
  readonly leaseId = 1;
  readonly payload = {socksPort: 41000};
  released = 0;
  readonly asked: PlainData[] = [];
  private readonly listeners: Array<(event: unknown) => void> = [];

  onEvent(listener: (event: unknown) => void): void {
    this.listeners.push(listener);
  }

  request(body: PlainData): Promise<unknown> {
    this.asked.push(body);
    const type = (body as {type: string}).type;
    const reply = type === 'connect' ? {type: 'accepted'} : {type: 'accepted'};
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
  requests: ConnectionAcquireRequest[];
  notices: ConnectionNotice[];
  channelsFor: unknown[];
  termsAsked: ConnectionTerms[];
  connecting: (
    cancellation?: AbortSignal,
  ) => ReturnType<ReturnType<typeof openConnectionStep>>;
}

function fixture(
  acquired: 'acquired' | 'spawnFailed' | 'endpointUnreachable' = 'acquired',
  channelFailureMessage?: string,
): Fixture {
  const lease = new FakeLease();
  const requests: ConnectionAcquireRequest[] = [];
  const notices: ConnectionNotice[] = [];
  const channelsFor: unknown[] = [];
  const termsAsked: ConnectionTerms[] = [];
  const step = openConnectionStep({
    acquire: request => {
      requests.push(request);
      return Promise.resolve(
        acquired === 'acquired'
          ? {
              kind: 'acquired',
              connection: new SharedConnection(
                lease as unknown as HelperLease,
                LIMITS,
                () => () => undefined,
              ),
            }
          : {kind: 'failed', failure: acquired},
      );
    },
    requestFor: (input, terms) => {
      termsAsked.push(terms);
      return {
        folder: '/registry',
        script: '/ext/helper.js',
        options: {
          request: JSON.stringify({remoteCommand: terms.remoteCommandInEffect}),
          unboundedWaitSeconds: 120,
          runtimeFolder: '/run',
          runtime: '/editor',
          askpassProgram: '/ext/askpass.js',
          displayHost: 'harness',
          externalAskpass: false,
          askpassFirstMessageMilliseconds: 5000,
        },
        policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
      };
    },
    channelFor: (connection, terms) => {
      if (channelFailureMessage !== undefined) {
        throw new Error(channelFailureMessage);
      }
      channelsFor.push([connection instanceof SharedConnection, terms]);
      return CHANNEL;
    },
    onNotice: notice => {
      notices.push(notice);
    },
  });
  return {
    lease,
    requests,
    notices,
    channelsFor,
    termsAsked,
    connecting: cancellation =>
      step(INPUT, TERMS, cancellation ?? new AbortController().signal),
  };
}

/** A fixture whose connect has gone through the login, with what the connect gave. */
async function loggedIn(): Promise<
  Fixture & {outcome: Awaited<ReturnType<Fixture['connecting']>>}
> {
  const ready = fixture();
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

  it('gives the pipeline the channel for the connection that is set up, once the login is done', async () => {
    const {channelsFor, outcome} = await loggedIn();
    deepStrictEqual(
      [
        outcome.kind === 'done' ? outcome.value.channel === CHANNEL : outcome,
        channelsFor,
      ],
      [true, [[true, TERMS]]],
    );
  });

  it('builds the request of the acquire from the terms of the connect', async () => {
    const {requests, connecting, termsAsked} = fixture();
    void connecting();
    await settled();
    deepStrictEqual(
      [termsAsked, requests[0]?.options.request],
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
      {
        type: 'prompt',
        promptId: 3,
        surface: 'maskedInput',
        text: "alex@harness's password: ",
      },
    ]);
  });

  it('stops telling the window once the connect is over', async () => {
    const {lease, notices, outcome} = await loggedIn();
    if (outcome.kind === 'done') {
      outcome.value.release();
    }
    lease.emit({type: 'waitingForOtherWindow'});
    deepStrictEqual(notices, []);
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

  it('fails when no lease can be taken, by the reason of the acquire', async () => {
    const {connecting} = fixture('endpointUnreachable');
    deepStrictEqual(await connecting(), {
      kind: 'failed',
      failure: {kind: 'channelClosed'},
    });
  });

  it('gives the lease back when the channel for the connection cannot be opened', async () => {
    const {lease, connecting} = fixture(
      'acquired',
      'the channel is gone',
    );
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
            reason: {text: 'Error: the channel is gone'},
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
