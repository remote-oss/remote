import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  acquire,
  type AcquireOutcome,
  type AcquireRequest,
  type ClientEnvironment,
  type HelperEvent,
  HelperLease,
  type HelperParameters,
  type MessageHandler,
  parseRecord,
  recordPath,
  serve,
  serializeRecord,
  type SpawnSpecification,
  spawnSpecification,
  stop,
} from '../../src/index.ts';
import {clientEnvironment} from '../../src/testing/client-environment.ts';
import {drive as driveClock} from '../../src/testing/drive.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';
import {FakeEndpointPort} from '../../src/testing/fake-endpoint.ts';
import type {EndpointConnection} from '../../src/endpoint/protocol.ts';
import {MemoryFilePort} from '../../src/testing/memory-file-port.ts';
import {helperParameters} from '../../src/runtime/helper-main.ts';

const PARAMETERS = 'REMOTE_OSS_HELPER_PARAMETERS';

async function settled(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}

describe('helper client', () => {
  let clock: FakeClock;
  let files: MemoryFilePort;
  let endpoints: FakeEndpointPort;
  let spawned: SpawnSpecification[];
  let spawnFails: boolean;
  let helperListens: boolean;
  let environment: ClientEnvironment;
  const handler: MessageHandler = {
    onRequest: (body, context) => {
      if (body === 'never') {
        return new Promise(() => undefined);
      }
      if (body === 'shout') {
        context.broadcast('heard');
      }
      if (body === 'fail') {
        return Promise.reject(new Error('not now'));
      }
      return Promise.resolve({echo: body});
    },
    runAction: () => Promise.resolve(),
  };

  function request(overrides: Partial<AcquireRequest> = {}): AcquireRequest {
    return {
      folder: '/registry',
      namespace: 'ssh.connection',
      helperKey: 'user@host:22',
      script: '/ext/dist/helpers/connection-server.js',
      options: {hostString: 'user@host:22'},
      policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
      payload: {port: 49152},
      cancellation: new AbortController().signal,
      ...overrides,
    };
  }

  function drive<T>(promise: Promise<T>): Promise<T> {
    return driveClock(promise, clock);
  }

  const RECORD_PATH = recordPath('/registry', 'ssh.connection', 'user@host:22');

  /** The text of a record whose helper listens at `endpoint`, if anything does. */
  function recordAt(endpoint: string, startedAt = 0): string {
    return serializeRecord({
      version: 1,
      namespace: 'ssh.connection',
      recordKey: 'user@host:22',
      endpoint,
      nonce: 'old',
      startedByProcessId: 1,
      startedAt,
      payload: {},
    });
  }

  /** Makes every removal of a record be followed by a rival writing `text` in its place. */
  function rivalWritesOnRemove(text: string): void {
    const remove = files.remove.bind(files);
    files.remove = async file => {
      await remove(file);
      files.files.set(file, text);
    };
  }

  /** Starts an acquire, lets it reach its wait, cancels it, and returns how it ended. */
  async function cancelledWhilePending(): Promise<AcquireOutcome> {
    const controller = new AbortController();
    const pending = acquire(
      environment,
      request({cancellation: controller.signal}),
    );
    await settled();
    controller.abort();
    return drive(pending);
  }

  function leaseOf(outcome: AcquireOutcome): HelperLease {
    if (outcome.kind !== 'acquired') {
      throw new Error(`no lease: ${outcome.failure}`);
    }
    return outcome.lease;
  }

  beforeEach(() => {
    clock = new FakeClock();
    files = new MemoryFilePort();
    endpoints = new FakeEndpointPort();
    spawned = [];
    spawnFails = false;
    helperListens = true;
    environment = clientEnvironment(
      {
        files,
        endpoints,
        spawn: specification => {
          spawned.push(specification);
          if (spawnFails) {
            return Promise.reject(new Error('no such file'));
          }
          if (helperListens) {
            // The fake helper reads its parameters as a real one does.
            const parameters = JSON.parse(
              specification.environment[PARAMETERS] ?? '',
            ) as HelperParameters;
            void serve({
              ...parameters,
              handler,
              port: endpoints,
              clock: () => clock.now(),
              scheduler: clock.scheduler(),
              helloLimitMilliseconds: 500,
              logLine: () => undefined,
            });
          }
          return Promise.resolve();
        },
      },
      clock,
    );
  });

  describe('spawn specification', () => {
    it("runs the script on the editor's runtime, detached, without a window or standard streams", () => {
      const specification = spawnSpecification(
        '/editor/code',
        '/ext/dist/helpers/x.js',
        {
          endpoint: '/run/rh.sock',
          nonce: 'n',
          policy: {kind: 'idleAfterLastLease', milliseconds: 1},
          payload: {},
          options: {},
        },
        {HOME: '/home/user', UNSET: undefined},
      );
      deepStrictEqual(
        [
          specification.command,
          specification.commandArguments,
          specification.detached,
          specification.stdio,
          specification.windowsHide,
          specification.environment.ELECTRON_RUN_AS_NODE,
          specification.environment.HOME,
          'UNSET' in specification.environment,
        ],
        [
          '/editor/code',
          ['/ext/dist/helpers/x.js'],
          true,
          'ignore',
          true,
          '1',
          '/home/user',
          false,
        ],
      );
    });

    it('passes the parameters, nonce included, in the environment and never on the command line', () => {
      const specification = spawnSpecification(
        '/editor/code',
        '/x.js',
        {
          endpoint: '/run/rh.sock',
          nonce: 'secret-nonce',
          policy: {kind: 'idleAfterLastLease', milliseconds: 1},
          payload: {},
          options: {},
        },
        {},
      );
      deepStrictEqual(
        [
          specification.commandArguments.join(' ').includes('secret-nonce'),
          helperParameters(specification.environment).nonce,
        ],
        [false, 'secret-nonce'],
      );
    });
  });

  describe('acquire', () => {
    it('claims a free key, starts the helper once and holds the first lease', async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual(
        [spawned.length, lease.startedByMe, lease.position(), lease.payload],
        [1, true, 0, {port: 49152}],
      );
    });

    it('records the acquirer as the starter and the endpoint, never the key, in the path', async () => {
      await drive(acquire(environment, request()));
      const record = parseRecord(files.files.get(RECORD_PATH) ?? '');
      deepStrictEqual(
        [record?.startedByProcessId, record?.endpoint.startsWith('/run/rh-')],
        [777, true],
      );
    });

    it('lets one of two racing acquirers start the helper and the other join it', async () => {
      const outcomes = await drive(
        Promise.all([
          acquire(environment, request()),
          acquire(environment, request()),
        ]),
      );
      deepStrictEqual(
        [spawned.length, outcomes.map(outcome => leaseOf(outcome).startedByMe)],
        [1, [true, false]],
      );
    });

    it('orders leases by arrival: the joiner is second', async () => {
      leaseOf(await drive(acquire(environment, request())));
      const second = leaseOf(await drive(acquire(environment, request())));
      strictEqual(second.position(), 1);
    });

    it('replaces a stale record once and starts a new helper', async () => {
      files.files.set(RECORD_PATH, recordAt('/run/gone.sock'));
      const lease = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual([spawned.length, lease.startedByMe], [1, true]);
    });

    it('replaces a corrupt record and starts a new helper', async () => {
      files.files.set(RECORD_PATH, '{broken');
      const lease = leaseOf(await drive(acquire(environment, request())));
      strictEqual(lease.startedByMe, true);
    });

    it('joins the helper another acquirer started during the replacement', async () => {
      const path = RECORD_PATH;
      files.files.set(path, '{broken');
      const winner = leaseOf(await drive(acquire(environment, request())));
      const remove = files.remove.bind(files);
      const winnerText = files.files.get(path) ?? '';
      files.remove = async file => {
        await remove(file);
        files.files.set(file, winnerText);
      };
      files.files.set(path, '{broken');
      const joiner = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual(
        [winner.startedByMe, joiner.startedByMe, spawned.length],
        [true, false, 1],
      );
    });

    it('fails as endpointUnreachable when the helper after the replacement does not answer', async () => {
      const path = RECORD_PATH;
      const deadText = recordAt('/run/gone.sock');
      files.files.set(path, deadText);
      rivalWritesOnRemove(deadText);
      deepStrictEqual(await drive(acquire(environment, request())), {
        kind: 'failed',
        failure: 'endpointUnreachable',
      });
    });

    it('fails as endpointUnreachable when a rival leaves a corrupt record during the replacement', async () => {
      const path = RECORD_PATH;
      files.files.set(path, '{broken');
      rivalWritesOnRemove('{broken');
      deepStrictEqual(await drive(acquire(environment, request())), {
        kind: 'failed',
        failure: 'endpointUnreachable',
      });
    });

    it('fails as spawnFailed and frees the key when the helper cannot start', async () => {
      spawnFails = true;
      deepStrictEqual(
        [await drive(acquire(environment, request())), files.files.size],
        [{kind: 'failed', failure: 'spawnFailed'}, 0],
      );
    });

    it('fails as endpointUnreachable when the started helper never listens', async () => {
      helperListens = false;
      deepStrictEqual(await drive(acquire(environment, request())), {
        kind: 'failed',
        failure: 'endpointUnreachable',
      });
    });

    it('is cancelled before it starts', async () => {
      const controller = new AbortController();
      controller.abort();
      deepStrictEqual(
        await drive(
          acquire(environment, request({cancellation: controller.signal})),
        ),
        {kind: 'failed', failure: 'cancelled'},
      );
    });

    it('is cancelled while it waits for the helper to listen', async () => {
      helperListens = false;
      deepStrictEqual(await cancelledWhilePending(), {
        kind: 'failed',
        failure: 'cancelled',
      });
    });

    it('waits for a helper that is still starting instead of replacing its record', async () => {
      const starterRecord = recordAt('/run/starting.sock', clock.now());
      files.files.set(RECORD_PATH, starterRecord);
      clock.scheduler().setTimer(300, () => {
        void serve({
          endpoint: '/run/starting.sock',
          nonce: 'old',
          payload: {},
          policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
          handler,
          port: endpoints,
          clock: () => clock.now(),
          scheduler: clock.scheduler(),
          helloLimitMilliseconds: 500,
          logLine: () => undefined,
        });
      });
      const lease = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual(
        [lease.startedByMe, spawned.length, files.files.get(RECORD_PATH)],
        [false, 0, starterRecord],
      );
    });

    it("replaces a silent record only after its starter's window has passed", async () => {
      files.files.set(RECORD_PATH, recordAt('/run/gone.sock', clock.now()));
      const lease = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual(
        [lease.startedByMe, spawned.length, clock.now() >= 2000],
        [true, 1, true],
      );
    });

    it('is cancelled while it waits for a helper that is still starting', async () => {
      files.files.set(RECORD_PATH, recordAt('/run/gone.sock', clock.now()));
      deepStrictEqual(await cancelledWhilePending(), {
        kind: 'failed',
        failure: 'cancelled',
      });
    });

    it('treats a helper that does not welcome in time as stale', async () => {
      const path = RECORD_PATH;
      await endpoints.listen('/run/silent.sock', () => undefined);
      files.files.set(path, recordAt('/run/silent.sock'));
      const lease = leaseOf(await drive(acquire(environment, request())));
      strictEqual(lease.startedByMe, true);
    });
  });

  describe('lease', () => {
    it("returns the handler's reply to a request", async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual(await drive(lease.request('ping', 1000)), {
        kind: 'reply',
        body: {echo: 'ping'},
      });
    });

    it('reports a request the handler rejects, with its reason', async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual(await drive(lease.request('fail', 1000)), {
        kind: 'rejected',
        reason: 'not now',
      });
    });

    it("times out at the caller's limit", async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      deepStrictEqual(await drive(lease.request('never', 1000)), {
        kind: 'timeout',
      });
    });

    it('settles a pending request as helperGone when the helper ends', async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      const pending = lease.request('never', 100000);
      await settled();
      await stop(environment, '/registry', 'ssh.connection', 'user@host:22');
      deepStrictEqual(await drive(pending), {kind: 'helperGone'});
    });

    it('reports the helper ending to its leases', async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      const events: HelperEvent[] = [];
      lease.onEvent(event => events.push(event));
      await stop(environment, '/registry', 'ssh.connection', 'user@host:22');
      await settled();
      deepStrictEqual(events.at(-1), {kind: 'helperGone'});
    });

    it('passes broadcasts and lease changes to every lease, in place order', async () => {
      const first = leaseOf(await drive(acquire(environment, request())));
      const events: HelperEvent[] = [];
      first.onEvent(event => events.push(event));
      const second = leaseOf(await drive(acquire(environment, request())));
      await drive(second.request('shout', 1000));
      second.release();
      await settled();
      deepStrictEqual(events, [
        {kind: 'leaseListChanged', leases: [1, 2]},
        {kind: 'message', body: 'heard'},
        {kind: 'leaseListChanged', leases: [1]},
      ]);
    });

    it('moves the second lease to first when the oldest releases', async () => {
      const first = leaseOf(await drive(acquire(environment, request())));
      const second = leaseOf(await drive(acquire(environment, request())));
      first.release();
      await settled();
      strictEqual(second.position(), 0);
    });

    it('reports no helperGone to the lease that released itself, and stops listening on request', async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      const events: HelperEvent[] = [];
      const unsubscribe = lease.onEvent(event => events.push(event));
      unsubscribe();
      lease.onEvent(event => events.push(event));
      lease.release();
      await settled();
      deepStrictEqual(events, []);
    });

    it('ignores a message of a kind it does not expect', async () => {
      const port = new FakeEndpointPort();
      let helperSide: EndpointConnection | undefined;
      await port.listen('/e', connection => {
        helperSide = connection;
      });
      const lease = new HelperLease(
        await port.connect('/e'),
        {type: 'welcome', lease: 1, leases: [1], payload: {}},
        false,
        environment.timer,
      );
      const events: HelperEvent[] = [];
      lease.onEvent(event => events.push(event));
      helperSide?.send({type: 'welcome', lease: 2, leases: [2], payload: {}});
      await settled();
      deepStrictEqual([events, lease.position()], [[], 0]);
    });

    it('ignores a late reply after its timeout', async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      const outcome = await drive(lease.request('never', 100));
      strictEqual(outcome.kind, 'timeout');
    });
  });

  describe('stop', () => {
    it('ends the running helper, which then ends its leases', async () => {
      const lease = leaseOf(await drive(acquire(environment, request())));
      await stop(environment, '/registry', 'ssh.connection', 'user@host:22');
      await settled();
      deepStrictEqual(await drive(lease.request('ping', 1000)), {
        kind: 'helperGone',
      });
    });

    it('is done when nothing runs', async () => {
      await stop(environment, '/registry', 'ssh.connection', 'user@host:22');
    });

    it('is done when the recorded helper cannot be reached', async () => {
      files.files.set(RECORD_PATH, recordAt('/run/gone.sock'));
      await stop(environment, '/registry', 'ssh.connection', 'user@host:22');
    });

    it('is done when the record is unreadable', async () => {
      files.files.set(RECORD_PATH, '{broken');
      await stop(environment, '/registry', 'ssh.connection', 'user@host:22');
    });
  });
});
