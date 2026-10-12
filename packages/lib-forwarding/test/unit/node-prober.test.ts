import {deepStrictEqual} from 'node:assert';
import {createServer, Socket, type Server} from 'node:net';
import {
  findFreePort,
  nodePortProber,
  PROBE_TIMEOUT_MILLISECONDS,
} from '../../src/index.ts';
import {proberOver} from '../../src/port-search/node-prober.ts';

describe('the port prober over node:net', () => {
  const servers: Server[] = [];

  /** The port a listening server holds, as its address says. */
  function portOf(server: Server): number {
    const address = server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  /** A fresh server on a free loopback port, once its listen has settled. */
  async function freshServer(): Promise<Server> {
    const server = createServer();
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    return server;
  }

  /** A loopback server on a free port, open until `afterEach` closes it. */
  async function listeningServer(): Promise<number> {
    const server = await freshServer();
    servers.push(server);
    return portOf(server);
  }

  /** A port that was listened on and then released: free, with nothing holding it. */
  async function releasedPort(): Promise<number> {
    const server = await freshServer();
    const port = portOf(server);
    await new Promise<void>(resolve => {
      server.close(() => {
        resolve();
      });
    });
    return port;
  }

  /** A synthetic socket error with the code a real one would carry. */
  function errorWith(code: string): NodeJS.ErrnoException {
    const error = new Error(`fake ${code}`) as NodeJS.ErrnoException;
    error.code = code;
    return error;
  }

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it('§W1: a port that is listening answers open', async () => {
    const port = await listeningServer();
    deepStrictEqual(await nodePortProber().probe(port), 'open');
  });

  it('§W1: a port that stopped listening answers refused', async () => {
    const port = await listeningServer();
    const server = servers.at(-1);
    if (server === undefined) {
      throw new Error('the test server is missing');
    }
    await new Promise<void>(resolve => {
      server.close(() => {
        resolve();
      });
    });
    deepStrictEqual(await nodePortProber().probe(port), 'refused');
  });

  it('§W1: an open probe is seen by the listener, and the probe closes it', async () => {
    const port = await listeningServer();
    const server = servers.at(-1);
    if (server === undefined) {
      throw new Error('the test server is missing');
    }
    const seen: string[] = [];
    const sawClose = new Promise<void>(resolve => {
      server.on('connection', socket => {
        seen.push('connect');
        socket.on('close', () => {
          seen.push('close');
          resolve();
        });
      });
    });
    await nodePortProber().probe(port);
    await sawClose;
    deepStrictEqual(seen, ['connect', 'close']);
  });

  it('§W1: a probe that never answers errors after the timer', async () => {
    const answer = await proberOver(() => new Socket(), 20).probe(1025);
    deepStrictEqual(answer, 'error');
  });

  it('§W1: an error that arrives after the timeout changes nothing', async () => {
    const socket = new Socket();
    const answer = await proberOver(() => {
      setTimeout(() => {
        socket.emit('error', errorWith('EACCES'));
      }, 40);
      return socket;
    }, 20).probe(1025);
    deepStrictEqual(answer, 'error');
  });

  it('§W1: a socket error other than a refusal answers error', async () => {
    const socket = new Socket();
    const answer = await proberOver(() => {
      queueMicrotask(() => {
        socket.emit('error', errorWith('EACCES'));
      });
      return socket;
    }, 5000).probe(1025);
    deepStrictEqual(answer, 'error');
  });

  it('§W1: a refusal answers once, and a later error changes nothing', async () => {
    const socket = new Socket();
    socket.on('error', () => undefined);
    const answer = await proberOver(() => {
      queueMicrotask(() => {
        socket.emit('error', errorWith('ECONNREFUSED'));
        queueMicrotask(() => {
          socket.emit('error', errorWith('EACCES'));
        });
      });
      return socket;
    }, 5000).probe(1025);
    deepStrictEqual(answer, 'refused');
  });

  it('§W1, F-2104 BR-7: the search over the real prober skips the taken port', async () => {
    const taken = await listeningServer();
    const prober = nodePortProber();
    let free = 0;
    for (let candidate = taken + 1; candidate <= taken + 200; candidate += 1) {
      if ((await prober.probe(candidate)) === 'refused') {
        free = candidate;
        break;
      }
    }
    if (free === 0) {
      throw new Error('no free port beside the taken one');
    }
    deepStrictEqual(
      await findFreePort(nodePortProber(), {first: taken, last: free}),
      {port: free},
    );
  });

  it('§W1: a probe holds nothing on the port, so a listen on it succeeds', async () => {
    const port = await releasedPort();
    const answer = await nodePortProber().probe(port);
    const server = createServer();
    servers.push(server);
    await new Promise<void>(resolve => {
      server.listen(port, '127.0.0.1', resolve);
    });
    const address = server.address();
    deepStrictEqual(
      [
        typeof address === 'object' && address !== null ? address.port : -1,
        answer,
      ],
      [port, 'refused'],
    );
  });

  it('§W1, F-2104 BR-7: the default probe timeout is 500 milliseconds, under the search budget', () => {
    deepStrictEqual(PROBE_TIMEOUT_MILLISECONDS, 500);
  });
});
