import {deepStrictEqual, strictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import type {EndpointConnection} from 'lib-helper';
import {
  type ConnectionHelperOptions,
  runConnectionHelper,
  type SshRequest,
} from '../../src/index.ts';
import {ScriptedSpawner} from './fake-client-process.ts';

const ENDPOINT = '/run/rh-0123456789abcdef.sock';
const NONCE = 'nonce-1';
const RECORD_FILE = '/registry/record.json';
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

  function start(request: SshRequest = REQUEST): Promise<unknown> {
    const options: ConnectionHelperOptions = {
      request: JSON.stringify(request),
      socksPort: 41000,
      unboundedWaitSeconds: 120,
      recordFile: RECORD_FILE,
    };
    return runConnectionHelper({
      parameters: {
        endpoint: ENDPOINT,
        nonce: NONCE,
        policy: {kind: 'graceAfterLastLease', milliseconds: 3000},
        payload: {socksPort: 41000},
        options: {...options},
      },
      port,
      clock: () => clock.now(),
      scheduler: clock.scheduler(),
      files,
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

  beforeEach(() => {
    port = new FakeEndpointPort();
    clock = new FakeClock();
    files = new MemoryFilePort();
    files.files.set(RECORD_FILE, '{}');
    spawner = new ScriptedSpawner(() => undefined);
    received = [];
  });

  it('runs ssh with the SOCKS forward and tells the window when it is set up', async () => {
    const ended = start();
    const connection = await join();
    connection.send({type: 'request', requestId: 1, body: {type: 'connect'}});
    await settled();
    spawner.started[0]?.error(
      'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".\n',
    );
    await settled();
    deepStrictEqual(
      [spawner.started[0]?.specification.programArguments, received.slice(-2)],
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
          {type: 'message', body: {type: 'connected', socksPort: 41000}},
        ],
      ],
    );
    connection.send({type: 'stop'});
    await ended;
  });

  it('ends the connect wait at the configured timeout of the host', async () => {
    const ended = start({
      ...REQUEST,
      effective: {...REQUEST.effective, connectTimeout: '5'},
    });
    const connection = await join();
    connection.send({type: 'request', requestId: 1, body: {type: 'connect'}});
    await settled();
    clock.advance(6999);
    const early = wasKilled();
    clock.advance(1);
    const late = wasKilled();
    connection.send({type: 'stop'});
    await ended;
    deepStrictEqual([early, late], [false, true]);
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

  it('removes its registry record when serving fails', async () => {
    port.listen = () => Promise.reject(new Error('no endpoint'));
    await start().catch(() => undefined);
    strictEqual(files.files.has(RECORD_FILE), false);
  });
});
