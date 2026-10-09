import {deepStrictEqual} from 'node:assert';
import {type ClientEnvironment, type HelperParameters} from 'lib-helper';
import {clientEnvironment} from 'lib-helper/testing/client-environment';
import {drive as driveClock} from 'lib-helper/testing/drive';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import {
  acquireConnection,
  type AcquireConnectionOutcome,
  type ConnectionAcquireRequest,
  type ConnectionNotice,
  type ConnectOutcome,
  killConnection,
  runConnectionHelper,
  type SharedConnection,
  type SshRequest,
} from '../../src/index.ts';
import {ScriptedSpawner, startError} from './fake-client-process.ts';

const PARAMETERS = 'REMOTE_OSS_HELPER_PARAMETERS';
const SOCKS_PORT = 41000;
const AUTHENTICATED =
  'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".\n';
const RECORD = {
  remotePort: 41001,
  operatingSystem: 'linux',
  architecture: 'x64',
  temporaryFolder: '/tmp',
  connectionToken: 'token-value',
};
const SSH_REQUEST: SshRequest = {
  purpose: 'connection',
  target: {host: 'harness'},
  settings: {
    configFile: '',
    connectTimeout: 15,
    permitPtyAllocation: false,
    remoteCommandInEffect: false,
  },
  effective: {
    hostName: 'harness',
    user: 'dev',
    port: '22',
    localForwards: [],
  },
  programs: {sshProgram: 'ssh', scpProgram: 'scp'},
  homeFolder: '/home/dev',
  platform: 'linux',
};

async function settled(rounds = 40): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}

describe('the window side of the shared connection (S9)', () => {
  let clock: FakeClock;
  let files: MemoryFilePort;
  let endpoints: FakeEndpointPort;
  let sshRuns: ScriptedSpawner;
  let helperEnds: Array<Promise<unknown>>;
  let spawnFails: boolean;
  let environment: {
    helper: ClientEnvironment;
    freePort: () => Promise<number>;
  };

  function request(
    changes: Partial<ConnectionAcquireRequest> = {},
  ): ConnectionAcquireRequest {
    return {
      folder: '/registry',
      hostString: 'harness',
      script: '/ext/dist/helpers/connection-server.js',
      options: {
        request: JSON.stringify(SSH_REQUEST),
        unboundedWaitSeconds: 120,
        runtimeFolder: '/run/user',
        runtime: '/editor/code',
        askpassProgram: '/ext/dist/helpers/askpass.js',
        displayHost: 'harness',
        externalAskpass: false,
        askpassFirstMessageMilliseconds: 5000,
      },
      policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
      cancellation: new AbortController().signal,
      ...changes,
    };
  }

  const LIMITS = {requestMilliseconds: 5000, loginMilliseconds: 60000};

  async function acquired(
    changes: Partial<ConnectionAcquireRequest> = {},
  ): Promise<SharedConnection> {
    const outcome: AcquireConnectionOutcome = await driven(
      acquireConnection(environment, request(changes), LIMITS),
    );
    if (outcome.kind !== 'acquired') {
      throw new Error(`no connection: ${outcome.failure}`);
    }
    return outcome.connection;
  }

  function driven<T>(promise: Promise<T>): Promise<T> {
    return driveClock(promise, clock);
  }

  /** Lets the work the fake clock and the fake endpoints queue run to its end. */
  async function drive(steps = 30): Promise<void> {
    for (let step = 0; step < steps; step++) {
      await settled();
      clock.advance(10);
    }
  }

  function notices(connection: SharedConnection): ConnectionNotice[] {
    const heard: ConnectionNotice[] = [];
    connection.onNotice(notice => heard.push(notice));
    return heard;
  }

  beforeEach(() => {
    clock = new FakeClock();
    files = new MemoryFilePort();
    endpoints = new FakeEndpointPort();
    sshRuns = new ScriptedSpawner(() => undefined);
    helperEnds = [];
    spawnFails = false;
    environment = {
      freePort: () => Promise.resolve(SOCKS_PORT),
      helper: clientEnvironment(
        {
          files,
          endpoints,
          spawn: specification => {
            if (spawnFails) {
              return Promise.reject(new Error('no such file'));
            }
            const parameters = JSON.parse(
              specification.environment[PARAMETERS] ?? '',
            ) as HelperParameters;
            helperEnds.push(
              runConnectionHelper({
                parameters,
                port: endpoints,
                clock: () => clock.now(),
                scheduler: clock.scheduler(),
                files,
                launcherFiles: {writeExecutable: () => Promise.resolve()},
                newNonce: () => 'askpass-nonce',
                spawner: sshRuns.spawn,
                editorEnvironment: {},
                helloLimitMilliseconds: 500,
                logLine: () => undefined,
              }),
            );
            return Promise.resolve();
          },
        },
        clock,
      ),
    };
  });

  /** The first window connects: the login is done when `ssh` reports the authentication. */
  async function connectFirst(): Promise<{
    connection: SharedConnection;
    outcome: Promise<ConnectOutcome>;
  }> {
    const connection = await acquired();
    const outcome = connection.connect(new AbortController().signal);
    await drive();
    return {connection, outcome};
  }

  it('starts the helper, asks it to connect, and reports the SOCKS port once ssh has authenticated', async () => {
    const {outcome} = await connectFirst();
    sshRuns.started[0]?.error(AUTHENTICATED);
    await drive();
    deepStrictEqual(await outcome, {
      kind: 'connected',
      socksPort: SOCKS_PORT,
      sharedRecord: null,
    });
  });

  it('starts ssh once, for the first window only', async () => {
    const {outcome} = await connectFirst();
    sshRuns.started[0]?.error(AUTHENTICATED);
    await outcome;
    const second = await acquired();
    await second.connect(new AbortController().signal);
    deepStrictEqual(sshRuns.started.length, 1);
  });

  it('gives a second window the connection that is set up, with the record the first left', async () => {
    const {connection, outcome} = await connectFirst();
    sshRuns.started[0]?.error(AUTHENTICATED);
    await outcome;
    await connection.storeSharedRecord(RECORD);
    const second = await acquired();
    deepStrictEqual(await second.connect(new AbortController().signal), {
      kind: 'connected',
      socksPort: SOCKS_PORT,
      sharedRecord: RECORD,
    });
  });

  it('refuses to store a record before the connection is set up', async () => {
    const {connection} = await connectFirst();
    deepStrictEqual(await connection.storeSharedRecord(RECORD), false);
  });

  it('makes a second window wait while the first logs in, and tells it so', async () => {
    await connectFirst();
    const second = await acquired();
    const heard = notices(second);
    void second.connect(new AbortController().signal);
    await drive();
    deepStrictEqual(heard, [{type: 'waitingForOtherWindow'}]);
  });

  it('connects the waiting window when the first one has authenticated', async () => {
    await connectFirst();
    const second = await acquired();
    const waiting = second.connect(new AbortController().signal);
    await drive();
    sshRuns.started[0]?.error(AUTHENTICATED);
    await drive();
    deepStrictEqual(await waiting, {
      kind: 'connected',
      socksPort: SOCKS_PORT,
      sharedRecord: null,
    });
  });

  it('reports a failed login to the window that asked for it, with the kind and the reason', async () => {
    const {outcome} = await connectFirst();
    sshRuns.started[0]?.error('dev@harness: Permission denied (publickey).\n');
    sshRuns.started[0]?.exit(255);
    await drive();
    deepStrictEqual(await outcome, {
      kind: 'failed',
      failure: {
        kind: 'loginFailed',
        failure: 'authentication',
        reason: {text: 'Permission denied (publickey).'},
        hints: [
          {
            status: 'PermissionDenied',
            message: 'Error: PermissionDenied',
            details: {text: 'Permission denied (publickey).'},
            mitigations: [],
            resources: [],
          },
        ],
      },
    });
  });

  it('lets the waiting window take over a failed login and try again with a new ssh', async () => {
    await connectFirst();
    const second = await acquired();
    const waiting = second.connect(new AbortController().signal);
    await drive();
    sshRuns.started[0]?.exit(255);
    await drive();
    sshRuns.started[1]?.error(AUTHENTICATED);
    await drive();
    deepStrictEqual(
      [sshRuns.started.length, (await waiting).kind],
      [2, 'connected'],
    );
  });

  it('tells a window that holds the connection when ssh is lost', async () => {
    const {connection, outcome} = await connectFirst();
    const heard = notices(connection);
    sshRuns.started[0]?.error(AUTHENTICATED);
    await outcome;
    sshRuns.started[0]?.exit(255);
    await drive();
    deepStrictEqual(
      heard.map(notice => notice.type),
      ['transportLost', 'helperGone'],
    );
  });

  /** The program of ssh asks `text` at the askpass endpoint, as it does when ssh needs an answer. */
  async function askAtEndpoint(text: string): Promise<void> {
    const askpass = await endpoints.connect(
      sshRuns.started[0]?.specification.environment
        .REMOTE_OSS_ASKPASS_ENDPOINT ?? '',
    );
    askpass.send({type: 'ask', nonce: 'askpass-nonce', text});
    await drive();
  }

  it('shows a question of ssh once and closes it for every window when one answers', async () => {
    const {connection} = await connectFirst();
    const heard = notices(connection);
    await askAtEndpoint("dev@harness's password: ");
    const joining = await acquired();
    await drive();
    const answered = await joining.answer(1, 'secret');
    await drive();
    deepStrictEqual(
      [heard.map(notice => notice.type), answered],
      [['prompt', 'promptClosed'], true],
    );
  });

  it('does not show an open question twice to a window that was told again', async () => {
    const {connection} = await connectFirst();
    const heard = notices(connection);
    await askAtEndpoint('password: ');
    await acquired();
    await drive();
    deepStrictEqual(
      heard.map(notice => notice.type),
      ['prompt'],
    );
  });

  it('refuses a second answer to the same question', async () => {
    const {connection} = await connectFirst();
    await askAtEndpoint('password: ');
    await connection.answer(1, 'first');
    deepStrictEqual(await connection.answer(1, 'second'), false);
  });

  it('stops telling a window that unsubscribed', async () => {
    const {connection} = await connectFirst();
    const heard: ConnectionNotice[] = [];
    const unsubscribe = connection.onNotice(notice => heard.push(notice));
    unsubscribe();
    await askAtEndpoint('password: ');
    deepStrictEqual(heard, []);
  });

  it('answers false after the helper is gone', async () => {
    const {connection} = await connectFirst();
    await killConnection(environment, '/registry', 'harness');
    await drive();
    deepStrictEqual(await connection.answer(1, 'late'), false);
  });

  it('reports an ssh that cannot be started as a failed start, not as a timeout', async () => {
    sshRuns = new ScriptedSpawner(startError('ENOENT', 'spawn ssh ENOENT'));
    const connection = await acquired();
    const outcome = connection.connect(new AbortController().signal);
    await drive();
    deepStrictEqual(await outcome, {
      kind: 'failed',
      failure: {
        kind: 'spawnFailed',
        cause: 'clientVanished',
        detail: 'spawn ssh ENOENT',
      },
    });
  });

  it('does not run the login limit down while a question waits for the user', async () => {
    const {connection, outcome} = await connectFirst();
    await askAtEndpoint('password: ');
    clock.advance(3 * LIMITS.loginMilliseconds);
    await connection.answer(1, 'secret');
    sshRuns.started[0]?.error(AUTHENTICATED);
    await drive();
    deepStrictEqual((await outcome).kind, 'connected');
  });

  it('starts the login limit over when the question is closed', async () => {
    const {connection, outcome} = await connectFirst();
    await askAtEndpoint('password: ');
    clock.advance(3 * LIMITS.loginMilliseconds);
    await connection.answer(1, 'secret');
    await drive();
    clock.advance(LIMITS.loginMilliseconds);
    await drive();
    deepStrictEqual(await outcome, {
      kind: 'failed',
      failure: {kind: 'timeout'},
    });
  });

  it('ends the wait when the caller cancels, and keeps the lease', async () => {
    const connection = await acquired();
    const controller = new AbortController();
    const outcome = connection.connect(controller.signal);
    await drive();
    controller.abort();
    deepStrictEqual(await outcome, {
      kind: 'failed',
      failure: {kind: 'cancelled'},
    });
  });

  it('does not ask at all when the caller has cancelled already', async () => {
    const connection = await acquired();
    const controller = new AbortController();
    controller.abort();
    await connection.connect(controller.signal);
    deepStrictEqual(sshRuns.started.length, 0);
  });

  it('ends the wait at the login limit', async () => {
    const connection = await acquired();
    const outcome = connection.connect(new AbortController().signal);
    await drive();
    clock.advance(LIMITS.loginMilliseconds);
    await drive();
    deepStrictEqual(await outcome, {
      kind: 'failed',
      failure: {kind: 'timeout'},
    });
  });

  it('reports a helper that is gone', async () => {
    const connection = await acquired();
    const outcome = connection.connect(new AbortController().signal);
    await drive();
    await killConnection(environment, '/registry', 'harness');
    await drive();
    deepStrictEqual(await outcome, {
      kind: 'failed',
      failure: {kind: 'helperGone'},
    });
  });

  it('ends ssh and the helper when the connection is killed', async () => {
    const {outcome} = await connectFirst();
    sshRuns.started[0]?.error(AUTHENTICATED);
    await outcome;
    await killConnection(environment, '/registry', 'harness');
    await drive();
    deepStrictEqual(
      [sshRuns.started[0]?.killed, await Promise.all(helperEnds)],
      [true, ['stopped']],
    );
  });

  it('kills silently when nothing runs', async () => {
    await killConnection(environment, '/registry', 'harness');
    deepStrictEqual(sshRuns.started.length, 0);
  });

  it('passes on the failure of the helper to start', async () => {
    spawnFails = true;
    deepStrictEqual(await acquireConnection(environment, request(), LIMITS), {
      kind: 'failed',
      failure: 'spawnFailed',
    });
  });

  it('gives the helper the SOCKS port and its record file as start values', async () => {
    await acquired();
    const [record] = [...files.files.keys()];
    deepStrictEqual(
      [sshRuns.started.length, record?.startsWith('/registry/ssh.connection/')],
      [0, true],
    );
  });

  it('ends the helper a grace after the last window releases its lease', async () => {
    const connection = await acquired();
    await drive();
    connection.release();
    await drive(400);
    deepStrictEqual(await Promise.all(helperEnds), ['policy']);
  });
});
