import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createConnection, Socket} from 'node:net';
import path from 'node:path';
import type {
  EndpointConnection,
  EndpointServer,
} from '../../src/endpoint/protocol.ts';
import {
  lineConnection,
  nodeEndpointPort,
} from '../../src/endpoint/node-endpoint.ts';
import {endpointPath, runtimeFolder} from '../../src/endpoint/path.ts';
import {readClientMessage} from '../../src/endpoint/protocol.ts';

describe('endpoint path', () => {
  it('uses XDG_RUNTIME_DIR on Linux', () => {
    strictEqual(
      runtimeFolder('linux', {XDG_RUNTIME_DIR: '/run/user/1000'}, '/tmp'),
      '/run/user/1000',
    );
  });

  it('uses the temporary folder on Linux without XDG_RUNTIME_DIR', () => {
    strictEqual(runtimeFolder('linux', {}, '/tmp'), '/tmp');
  });

  it('uses the temporary folder on macOS', () => {
    strictEqual(
      runtimeFolder('darwin', {XDG_RUNTIME_DIR: '/run/user/1000'}, '/var/t'),
      '/var/t',
    );
  });

  it('names the socket rh- and 16 hex digits, showing nothing of the key', () => {
    const endpoint = endpointPath(
      '/run',
      'ssh.connection',
      'user@host:22',
      'n1',
    );
    strictEqual(/^\/run\/rh-[0-9a-f]{16}\.sock$/.test(endpoint), true);
  });

  it('gives each nonce its own endpoint', () => {
    strictEqual(
      endpointPath('/run', 'ssh', 'host', 'n1') ===
        endpointPath('/run', 'ssh', 'host', 'n2'),
      false,
    );
  });
});

describe('client messages', () => {
  it('reads a hello, a request and a stop', () => {
    deepStrictEqual(
      [
        readClientMessage({type: 'hello', nonce: 'n'}),
        readClientMessage({type: 'request', requestId: 1, body: [1]}),
        readClientMessage({type: 'stop'}),
      ],
      [
        {type: 'hello', nonce: 'n'},
        {type: 'request', requestId: 1, body: [1]},
        {type: 'stop'},
      ],
    );
  });

  it('reads nothing from other values', () => {
    deepStrictEqual(
      [
        readClientMessage(null),
        readClientMessage({type: 'hello'}),
        readClientMessage({type: 'request', requestId: '1', body: 1}),
        readClientMessage({type: 'request', requestId: 1}),
        readClientMessage({type: 'other'}),
      ],
      [undefined, undefined, undefined, undefined, undefined],
    );
  });
});

describe('Node.js endpoint', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'helper-endpoint-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  /** A server on a socket in the test folder, and a client connected to it. */
  async function connectedPair(
    onConnection: (connection: EndpointConnection) => void,
  ): Promise<{server: EndpointServer; client: EndpointConnection}> {
    const endpoint = path.join(folder, 'rh-test.sock');
    const port = nodeEndpointPort('linux');
    const server = await port.listen(endpoint, onConnection);
    return {server, client: await port.connect(endpoint)};
  }

  it('exchanges messages both ways over a socket only the user can open', async () => {
    const received: unknown[] = [];
    const {server, client} = await connectedPair(connection => {
      connection.onMessage(message => {
        connection.send({echo: message});
      });
    });
    const mode = statSync(path.join(folder, 'rh-test.sock')).mode & 0o777;
    const echoed = new Promise<void>(resolve => {
      client.onMessage(message => {
        received.push(message);
        resolve();
      });
    });
    client.send({type: 'stop'});
    await echoed;
    const closed = new Promise<void>(resolve => {
      client.onClose(resolve);
    });
    client.close();
    await closed;
    await server.close();
    deepStrictEqual([mode, received], [0o600, [{echo: {type: 'stop'}}]]);
  });

  it('ends a connection that sends a line that is not JSON', async () => {
    const endpoint = path.join(folder, 'rh-test.sock');
    const port = nodeEndpointPort('linux');
    let server: EndpointServer | undefined;
    let rawSocket: Socket | undefined;
    const closedByHelper = new Promise<void>(resolve => {
      void port
        .listen(endpoint, connection => {
          connection.onClose(resolve);
        })
        .then(listening => {
          server = listening;
          const socket = createConnection(endpoint);
          rawSocket = socket;
          socket.write('not json\n');
        });
    });
    await closedByHelper;
    rawSocket?.destroy();
    await server?.close();
  });

  it('drops what is sent after the connection closed', async () => {
    const received: unknown[] = [];
    const {server, client} = await connectedPair(connection => {
      connection.onMessage(message => received.push(message));
    });
    const closed = new Promise<void>(resolve => {
      client.onClose(resolve);
    });
    client.close();
    await closed;
    client.send({type: 'stop'});
    await server.close();
    deepStrictEqual(received, []);
  });

  it('closes the server although a client never ends its side', async () => {
    const endpoint = path.join(folder, 'rh-test.sock');
    const port = nodeEndpointPort('linux');
    let helperSide: EndpointConnection | undefined;
    const server = await port.listen(endpoint, connection => {
      helperSide = connection;
    });
    const silent = createConnection({path: endpoint, allowHalfOpen: true});
    await new Promise<void>(resolve => {
      silent.once('connect', resolve);
    });
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    helperSide?.close();
    await server.close();
    silent.destroy();
  });

  it('closes a connection whose socket fails', async () => {
    const socket = new Socket();
    const connection = lineConnection(socket);
    const closed = new Promise<void>(resolve => {
      connection.onClose(resolve);
    });
    socket.emit('error', new Error('broken pipe'));
    await closed;
  });

  it('rejects a connection when nothing listens', async () => {
    await rejects(
      nodeEndpointPort('linux').connect(path.join(folder, 'none.sock')),
    );
  });

  it('rejects listening on a path that cannot hold a socket', async () => {
    await rejects(
      nodeEndpointPort('linux').listen(
        path.join(folder, 'missing', 'rh.sock'),
        () => undefined,
      ),
    );
  });

  it('refuses on Windows until the named pipe has been run there', async () => {
    await rejects(
      nodeEndpointPort('win32').listen('pipe', () => undefined),
      {
        message:
          'helper endpoints on Windows (named pipes) are not available yet',
      },
    );
  });
});
