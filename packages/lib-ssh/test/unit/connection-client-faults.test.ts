import {deepStrictEqual} from 'node:assert';
import {
  acquire,
  type ClientEnvironment,
  type HelperParameters,
  type MessageHandler,
  type PlainData,
  serve,
} from 'lib-helper';
import {clientEnvironment} from 'lib-helper/testing/client-environment';
import {drive as driveClock} from 'lib-helper/testing/drive';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import {
  type ConnectionLimits,
  type ConnectionNotice,
  type ConnectOutcome,
  SharedConnection,
} from '../../src/index.ts';

const PARAMETERS = 'REMOTE_OSS_HELPER_PARAMETERS';
const LIMITS: ConnectionLimits = {
  requestMilliseconds: 1000,
  loginMilliseconds: 5000,
};
const RECORD = {
  remotePort: 41001,
  operatingSystem: 'linux',
  architecture: 'x64',
  temporaryFolder: '/tmp',
  connectionToken: 'token-value',
};

/** What the helper under test does with a kind of request. */
type Plan = {reply: PlainData} | {fail: 'reject' | 'never'};

describe('the window side against a helper that does not follow the protocol', () => {
  let clock: FakeClock;
  let environment: ClientEnvironment;
  let plans: Map<string, Plan>;
  let garbage: PlainData[];
  let heard: ConnectionNotice[];

  const handler: MessageHandler = {
    onRequest: (body, context) => {
      for (const message of garbage) {
        context.broadcast(message);
      }
      const plan = plans.get((body as {type: string}).type);
      if (plan !== undefined && 'fail' in plan) {
        return plan.fail === 'reject'
          ? Promise.reject(new Error('not now'))
          : new Promise(() => undefined);
      }
      return Promise.resolve(plan?.reply ?? {type: 'accepted'});
    },
    runAction: () => Promise.resolve(),
  };

  function driven<T>(promise: Promise<T>): Promise<T> {
    return driveClock(promise, clock);
  }

  /** A connection to a helper that serves `payload` and answers as `plans` says. */
  async function connection(
    payload: Record<string, number> = {socksPort: 41000},
  ): Promise<SharedConnection> {
    const outcome = await driven(
      acquire(environment, {
        folder: '/registry',
        namespace: 'ssh.connection',
        helperKey: 'harness',
        script: '/ext/helper.js',
        options: {},
        policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
        payload,
        cancellation: new AbortController().signal,
      }),
    );
    if (outcome.kind !== 'acquired') {
      throw new Error(`no lease: ${outcome.failure}`);
    }
    const shared = new SharedConnection(
      outcome.lease,
      LIMITS,
      environment.timer,
    );
    shared.onNotice(notice => heard.push(notice));
    return shared;
  }

  function connect(shared: SharedConnection): Promise<ConnectOutcome> {
    return driven(shared.connect(new AbortController().signal));
  }

  beforeEach(() => {
    clock = new FakeClock();
    plans = new Map();
    garbage = [];
    heard = [];
    const endpoints = new FakeEndpointPort();
    const files = new MemoryFilePort();
    environment = clientEnvironment(
      {
        files,
        endpoints,
        spawn: specification => {
          void serve({
            files,
            ...(JSON.parse(
              specification.environment[PARAMETERS] ?? '',
            ) as HelperParameters),
            handler,
            port: endpoints,
            clock: () => clock.now(),
            scheduler: clock.scheduler(),
            helloLimitMilliseconds: 500,
            logLine: () => undefined,
          });
          return Promise.resolve();
        },
      },
      clock,
    );
  });

  it('fails a connect that the helper rejects', async () => {
    plans.set('connect', {fail: 'reject'});
    deepStrictEqual(await connect(await connection()), {
      kind: 'failed',
      failure: {kind: 'helperRefused', reason: 'not now'},
    });
  });

  it('fails a connect that the helper never answers, at the request limit', async () => {
    plans.set('connect', {fail: 'never'});
    deepStrictEqual(await connect(await connection()), {
      kind: 'failed',
      failure: {kind: 'timeout'},
    });
  });

  it('fails a connect whose reply is no reply of the protocol', async () => {
    plans.set('connect', {reply: {nonsense: true}});
    deepStrictEqual(await connect(await connection()), {
      kind: 'failed',
      failure: {kind: 'helperRefused', reason: 'unreadable reply'},
    });
  });

  it('fails a connect answered with the reply to another request', async () => {
    plans.set('connect', {reply: {type: 'answered', accepted: true}});
    deepStrictEqual(await connect(await connection()), {
      kind: 'failed',
      failure: {kind: 'helperRefused', reason: 'unexpected reply'},
    });
  });

  it('fails when the connection is set up and the helper gave no SOCKS port', async () => {
    plans.set('connect', {
      reply: {type: 'refused', reason: 'alreadyConnected'},
    });
    deepStrictEqual(await connect(await connection({})), {
      kind: 'failed',
      failure: {kind: 'helperRefused', reason: 'no SOCKS port'},
    });
  });

  it('fails when the connection is set up and the helper will not give the record', async () => {
    plans.set('connect', {
      reply: {type: 'refused', reason: 'alreadyConnected'},
    });
    plans.set('sharedRecord', {fail: 'reject'});
    deepStrictEqual(await connect(await connection()), {
      kind: 'failed',
      failure: {kind: 'helperRefused', reason: 'not now'},
    });
  });

  it('takes a reply to the record request that is no record as no record', async () => {
    plans.set('connect', {
      reply: {type: 'refused', reason: 'alreadyConnected'},
    });
    plans.set('sharedRecord', {reply: {type: 'accepted'}});
    deepStrictEqual(await connect(await connection()), {
      kind: 'connected',
      socksPort: 41000,
      sharedRecord: null,
    });
  });

  it('ignores a message of the helper that is no event', async () => {
    garbage = [{nonsense: 1}, 'text'];
    plans.set('connect', {
      reply: {type: 'refused', reason: 'alreadyConnected'},
    });
    plans.set('sharedRecord', {reply: {type: 'sharedRecord', record: RECORD}});
    deepStrictEqual(await connect(await connection()), {
      kind: 'connected',
      socksPort: 41000,
      sharedRecord: RECORD,
    });
  });

  it('fails a connect that is overtaken by a loss of the connection', async () => {
    garbage = [{type: 'transportLost'}];
    plans.set('connect', {fail: 'never'});
    deepStrictEqual(await connect(await connection()), {
      kind: 'failed',
      failure: {kind: 'transportLost'},
    });
  });

  it('answers false when the helper cannot be reached for the answer', async () => {
    plans.set('answer', {fail: 'reject'});
    deepStrictEqual(await driven((await connection()).answer(1, 'x')), false);
  });

  it('stores nothing when the helper rejects the record', async () => {
    plans.set('setSharedRecord', {fail: 'reject'});
    deepStrictEqual(
      await driven((await connection()).storeSharedRecord(RECORD)),
      false,
    );
  });

  it('shows no notice for the connected event', async () => {
    garbage = [{type: 'connected', socksPort: 1}];
    plans.set('connect', {
      reply: {type: 'refused', reason: 'alreadyConnecting'},
    });
    const shared = await connection();
    void shared.connect(new AbortController().signal);
    await driven(Promise.resolve());
    deepStrictEqual(heard, [{type: 'waitingForOtherWindow'}]);
  });
});
