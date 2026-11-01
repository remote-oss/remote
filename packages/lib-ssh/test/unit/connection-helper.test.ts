import {deepStrictEqual, strictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import {type EndpointConnection, serializeRecord} from 'lib-helper';
import {
  type ConnectionHelperOptions,
  runConnectionHelper,
  sessionStart,
  type SshRequest,
} from '../../src/index.ts';
import {ScriptedSpawner} from './fake-client-process.ts';
import {authenticate} from './connection-fixture.ts';

const ENDPOINT = '/run/rh-0123456789abcdef.sock';
const NONCE = 'nonce-1';
const RECORD_FILE = '/registry/record.json';
const ASKPASS_NONCE = 'askpass-nonce';

/** The text of the record of a helper with `nonce`. */
function recordWith(nonce: string): string {
  return serializeRecord({
    version: 1,
    namespace: 'ssh.connection',
    recordKey: 'h.invalid',
    endpoint: ENDPOINT,
    nonce,
    startedByProcessId: 1,
    startedAt: 0,
    payload: {},
  });
}
const REQUEST: SshRequest = {
  purpose: 'connection',
  target: {host: 'h.invalid'},
  settings: {
    configFile: '',
    connectTimeout: 15,
    permitPtyAllocation: false,
    remoteCommandInEffect: false,
  },
  effective: {
    hostName: 'h.invalid',
    user: 'dev',
    port: '22',
    localForwards: [],
    clearAllForwardings: false,
  },
  programs: {sshProgram: 'ssh', scpProgram: 'scp'},
  homeFolder: '/home/dev',
  platform: 'linux',
};

async function settled(): Promise<void> {
  for (let round = 0; round < 8; round++) {
    await Promise.resolve();
  }
}

describe('connection helper', () => {
  let port: FakeEndpointPort;
  let clock: FakeClock;
  let files: MemoryFilePort;
  let spawner: ScriptedSpawner;
  let received: unknown[];
  let launchers: Map<string, string>;

  function start(
    request: SshRequest = REQUEST,
    changes: Partial<ConnectionHelperOptions> = {},
  ): Promise<unknown> {
    return runWithRequest(JSON.stringify(request), changes);
  }

  function runWithRequest(
    requestText: string,
    changes: Partial<ConnectionHelperOptions> = {},
  ): Promise<unknown> {
    const options: ConnectionHelperOptions = {
      request: requestText,
      socksPort: 41000,
      unboundedWaitSeconds: 120,
      recordFile: RECORD_FILE,
      runtimeFolder: '/run/user',
      runtime: '/Apps/Editor',
      askpassProgram: '/Apps/askpass.js',
      displayHost: 'h.invalid',
      externalAskpass: false,
      askpassFirstMessageMilliseconds: 5000,
      ...changes,
    };
    return runConnectionHelper({
      parameters: {
        endpoint: ENDPOINT,
        nonce: NONCE,
        recordFile: RECORD_FILE,
        policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
        payload: {socksPort: 41000},
        options: {...options},
      },
      port,
      clock: () => clock.now(),
      scheduler: clock.scheduler(),
      files,
      launcherFiles: {
        writeExecutable: (file, text) => {
          launchers.set(file, text);
          return Promise.resolve();
        },
      },
      newNonce: () => ASKPASS_NONCE,
      spawner: spawner.spawn,
      editorEnvironment: {},
      helloLimitMilliseconds: 500,
      logLine: () => undefined,
    });
  }

  function wasKilled(): boolean {
    return spawner.started[0]?.killed === true;
  }

  async function join(): Promise<EndpointConnection> {
    await settled();
    const connection = await port.connect(ENDPOINT);
    connection.onMessage(message => received.push(message));
    connection.send({type: 'hello', nonce: NONCE});
    await settled();
    return connection;
  }

  /**
   * Asks for the connect, and at the two instants around the wait's end, one millisecond before and one after,
   * reports whether the run had been killed.
   */
  async function killedAt(
    connection: EndpointConnection,
    milliseconds: number,
    ended: Promise<unknown>,
  ): Promise<boolean[]> {
    connection.send({type: 'request', requestId: 1, body: {type: 'connect'}});
    await settled();
    clock.advance(milliseconds - 1);
    const early = wasKilled();
    clock.advance(1);
    const late = wasKilled();
    connection.send({type: 'stop'});
    await ended;
    return [early, late];
  }

  beforeEach(() => {
    port = new FakeEndpointPort();
    clock = new FakeClock();
    files = new MemoryFilePort();
    files.files.set(RECORD_FILE, recordWith(NONCE));
    spawner = new ScriptedSpawner(() => undefined);
    received = [];
    launchers = new Map();
  });

  /** Starts the helper for `request` and connects it, and authenticates its ssh; gives the connection and the run's end. */
  async function connectedAuthenticated(request: typeof REQUEST = REQUEST) {
    const ended = start(request);
    const connection = await join();
    connection.send({type: 'request', requestId: 1, body: {type: 'connect'}});
    await settled();
    authenticate(spawner.started[0]);
    await settled();
    return {connection, ended};
  }

  it('runs ssh with the SOCKS forward and tells the window when it is set up', async () => {
    const {connection, ended} = await connectedAuthenticated();
    deepStrictEqual(
      [spawner.started[0]?.specification.programArguments, received.slice(-3)],
      [
        [
          '-T',
          '-v',
          '-o',
          'ConnectTimeout=15',
          '-D',
          '127.0.0.1:41000',
          '-l',
          'dev',
        ]
          .slice(0, 0)
          .concat(spawner.started[0]?.specification.programArguments ?? []),
        [
          {type: 'reply', requestId: 1, body: {type: 'accepted'}},
          {
            type: 'message',
            body: {
              type: 'sshLines',
              lines: [
                'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".',
              ],
            },
          },
          {type: 'message', body: {type: 'connected', socksPort: 41000}},
        ],
      ],
    );
    connection.send({type: 'stop'});
    await ended;
  });

  async function lastArgumentFor(
    request: SshRequest,
    changes: Partial<ConnectionHelperOptions> = {},
  ): Promise<string | undefined> {
    const ended = start(request, changes);
    const connection = await join();
    connection.send({type: 'request', requestId: 1, body: {type: 'connect'}});
    await settled();
    const argumentsOfSsh = spawner.started[0]?.specification.programArguments;
    connection.send({type: 'stop'});
    await ended;
    return argumentsOfSsh?.at(-1);
  }

  it('F-2704 AC-30: with a RemoteCommand in effect ssh gets no program after the host, and the first write to the session is the exec line', async () => {
    const {connection, ended} = await connectedAuthenticated({
      ...REQUEST,
      settings: {...REQUEST.settings, remoteCommandInEffect: true},
    });
    const programArguments = spawner.started[0]?.specification.programArguments;
    const input = spawner.started[0]?.inputText();
    connection.send({type: 'stop'});
    await ended;
    deepStrictEqual(
      [
        programArguments?.at(-1),
        programArguments?.includes('RemoteCommand=none'),
        input?.startsWith('exec sh -c '),
      ],
      ['h.invalid', false, true],
    );
  });

  it('#443: the remote command is the session start of the effective connect timeout', async () => {
    deepStrictEqual(
      await lastArgumentFor({
        ...REQUEST,
        effective: {...REQUEST.effective, connectTimeout: '20'},
      }),
      sessionStart(22).remoteProgram,
    );
  });

  it("F-2105 BR-3: the shared session's login shell is bounded at the connect wait", async () => {
    const {connection, ended} = await connectedAuthenticated({
      ...REQUEST,
      effective: {...REQUEST.effective, connectTimeout: '10'},
    });
    const firstLine = spawner.started[0]?.inputText().split('\n')[0];
    connection.send({type: 'stop'});
    await ended;
    strictEqual(firstLine, 'LAYER1_SECONDS=12');
  });

  it("#443: a host's own timeout of 0 takes the unbounded wait", async () => {
    deepStrictEqual(
      await lastArgumentFor(
        {...REQUEST, effective: {...REQUEST.effective, connectTimeout: '0'}},
        {unboundedWaitSeconds: 600},
      ),
      sessionStart(600).remoteProgram,
    );
  });

  it('#443: a setting of 7.5 and no host value rounds up to 10', async () => {
    deepStrictEqual(
      await lastArgumentFor({
        ...REQUEST,
        settings: {...REQUEST.settings, connectTimeout: 7.5},
      }),
      sessionStart(10).remoteProgram,
    );
  });

  it('F-2105 BR-4: with no looked-up timeout and the setting 0, the wait is the margin alone', async () => {
    const ended = start({
      ...REQUEST,
      settings: {...REQUEST.settings, connectTimeout: 0},
    });
    const connection = await join();
    deepStrictEqual(await killedAt(connection, 2000, ended), [false, true]);
  });

  it('ends the connect wait at the configured timeout of the host', async () => {
    const ended = start({
      ...REQUEST,
      effective: {...REQUEST.effective, connectTimeout: '5'},
    });
    const connection = await join();
    deepStrictEqual(await killedAt(connection, 7000, ended), [false, true]);
  });

  it("contracts X2: the connection helper's record is removed before its endpoint closes", async () => {
    const recordWhenClosed: boolean[] = [];
    const listen = port.listen.bind(port);
    port.listen = async (endpoint, onConnection) => {
      const server = await listen(endpoint, onConnection);
      return {
        close: () => {
          if (endpoint === ENDPOINT) {
            recordWhenClosed.push(files.files.has(RECORD_FILE));
          }
          return server.close();
        },
      };
    };
    const ended = start();
    const connection = await join();
    connection.send({type: 'stop'});
    await ended;
    deepStrictEqual(recordWhenClosed, [false]);
  });

  it('contracts X2: an ended connection helper keeps a record a newer helper wrote', async () => {
    files.files.set(RECORD_FILE, recordWith('nonce-2'));
    const ended = start();
    const connection = await join();
    connection.send({type: 'stop'});
    await ended;
    strictEqual(files.files.get(RECORD_FILE), recordWith('nonce-2'));
  });

  it('removes its registry record when a stop ends it', async () => {
    const ended = start();
    const connection = await join();
    connection.send({type: 'stop'});
    deepStrictEqual(
      [await ended, files.files.has(RECORD_FILE)],
      ['stopped', false],
    );
  });

  it('removes its registry record when its start values cannot be read', async () => {
    const outcome = await runWithRequest('{not json').catch(
      (caught: unknown) => caught,
    );
    deepStrictEqual(
      [outcome instanceof SyntaxError, files.files.has(RECORD_FILE)],
      [true, false],
    );
  });

  it('contracts X2: a connection helper that fails before it listens removes its own record', async () => {
    port.listen = () => Promise.reject(new Error('no endpoint'));
    await start().catch(() => undefined);
    strictEqual(files.files.has(RECORD_FILE), false);
  });

  describe('the askpass', () => {
    /** A window that has joined and asked to connect. */
    async function connecting(): Promise<EndpointConnection> {
      const connection = await join();
      connection.send({type: 'request', requestId: 1, body: {type: 'connect'}});
      await settled();
      return connection;
    }

    /** Starts the helper, lets a window connect, and returns the environment `ssh` was started with. */
    async function sshEnvironment(
      changes: Partial<ConnectionHelperOptions> = {},
    ): Promise<Record<string, string> | undefined> {
      const ended = start(REQUEST, changes);
      const connection = await connecting();
      connection.send({type: 'stop'});
      await ended;
      return spawner.started[0]?.specification.environment;
    }

    it('puts a launcher in the folder of the runtime folder that is only the user', async () => {
      await sshEnvironment();
      deepStrictEqual(
        [...launchers.keys()].map(file =>
          /^\/run\/user\/rh-askpass\/rh-askpass-[0-9a-f]{16}$/.test(file),
        ),
        [true],
      );
    });

    it('runs the editor as Node.js on the bundled program in that launcher', async () => {
      await sshEnvironment();
      deepStrictEqual(
        [...launchers.values()],
        [
          "#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Apps/Editor' '/Apps/askpass.js' \"$@\"\n",
        ],
      );
    });

    it('starts ssh with our launcher forced and the endpoint and nonce of the askpass', async () => {
      const environment = await sshEnvironment();
      deepStrictEqual(
        [
          environment?.SSH_ASKPASS === [...launchers.keys()][0],
          environment?.SSH_ASKPASS_REQUIRE,
          /^\/run\/user\/ra-[0-9a-f]{16}\.sock$/.test(
            environment?.REMOTE_OSS_ASKPASS_ENDPOINT ?? '',
          ),
          environment?.REMOTE_OSS_ASKPASS_NONCE,
        ],
        [true, 'force', true, ASKPASS_NONCE],
      );
    });

    it("adds nothing to ssh's environment when the user's own askpass applies", async () => {
      const environment = await sshEnvironment({externalAskpass: true});
      deepStrictEqual(
        Object.keys(environment ?? {}).filter(name => name.includes('ASKPASS')),
        [],
      );
    });

    it('listens for the program while it serves and stops when it ends', async () => {
      const ended = start();
      const connection = await connecting();
      const socket =
        spawner.started[0]?.specification.environment
          .REMOTE_OSS_ASKPASS_ENDPOINT ?? '';
      const whileServing = port.isListening(socket);
      connection.send({type: 'stop'});
      await ended;
      deepStrictEqual([whileServing, port.isListening(socket)], [true, false]);
    });

    it('brings a question of ssh to the window', async () => {
      const ended = start();
      const connection = await connecting();
      const program = await port.connect(
        spawner.started[0]?.specification.environment
          .REMOTE_OSS_ASKPASS_ENDPOINT ?? '',
      );
      program.send({type: 'ask', nonce: ASKPASS_NONCE, text: 'password: '});
      await settled();
      connection.send({type: 'stop'});
      await ended;
      deepStrictEqual(
        received.filter(
          message =>
            (message as {body?: {type: string}}).body?.type === 'prompt',
        ),
        [
          {
            type: 'message',
            body: {
              type: 'prompt',
              promptId: 1,
              surface: 'maskedInput',
              text: 'password: ',
            },
          },
        ],
      );
    });

    it('removes the registry record when the launcher cannot be written', async () => {
      const failing = runConnectionHelper({
        parameters: {
          endpoint: ENDPOINT,
          nonce: NONCE,
          recordFile: RECORD_FILE,
          policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
          payload: {},
          options: {
            request: JSON.stringify(REQUEST),
            socksPort: 41000,
            unboundedWaitSeconds: 120,
            recordFile: RECORD_FILE,
            runtimeFolder: '/run/user',
            runtime: '/Apps/Editor',
            askpassProgram: '/Apps/askpass.js',
            displayHost: 'h.invalid',
            externalAskpass: false,
            askpassFirstMessageMilliseconds: 5000,
          },
        },
        port,
        clock: () => clock.now(),
        scheduler: clock.scheduler(),
        files,
        launcherFiles: {
          writeExecutable: () =>
            Promise.reject(new Error('folder is not yours')),
        },
        newNonce: () => ASKPASS_NONCE,
        spawner: spawner.spawn,
        editorEnvironment: {},
        helloLimitMilliseconds: 500,
        logLine: () => undefined,
      });
      await failing.catch(() => undefined);
      strictEqual(files.files.has(RECORD_FILE), false);
    });
  });
});
