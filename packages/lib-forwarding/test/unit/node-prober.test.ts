import {deepStrictEqual} from 'node:assert';
import {createConnection, createServer, Server} from 'node:net';
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

  /** A server whose listen does as `onListen` says instead of binding. */
  function scriptedServer(onListen: (server: Server) => void): () => Server {
    return () => {
      const server = new Server();
      server.listen = (() => {
        onListen(server);
        return server;
      }) as Server['listen'];
      return server;
    };
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

  it("§W1: a port held by a connected client socket answers open, as the relay's listen would fail", async () => {
    const port = await listeningServer();
    const client = createConnection({host: '127.0.0.1', port});
    await new Promise<void>(resolve => {
      client.once('connect', resolve);
    });
    const clientPort = client.localPort;
    servers.at(-1)?.close();
    const answer = await nodePortProber().probe(clientPort ?? 0);
    client.destroy();
    deepStrictEqual(answer, 'open');
  });

  it('§W1: a port that stopped listening answers refused', async () => {
    const port = await releasedPort();
    deepStrictEqual(await nodePortProber().probe(port), 'refused');
  });

  it('§W1: a probe holds nothing on the port, so a listen on it succeeds', async () => {
    const port = await releasedPort();
    const answer = await nodePortProber().probe(port);
    const server = createServer();
    servers.push(server);
    await new Promise<void>(resolve => {
      server.listen(port, '127.0.0.1', resolve);
    });
    deepStrictEqual([portOf(server), answer], [port, 'refused']);
  });

  it('§W1: a probe that never answers times out after the timer', async () => {
    const answer = await proberOver(
      scriptedServer(() => undefined),
      20,
    ).probe(1025);
    deepStrictEqual(answer, 'timedOut');
  });

  it('§W1: an error that arrives after the timeout changes nothing', async () => {
    const answer = await proberOver(
      scriptedServer(server => {
        setTimeout(() => {
          server.emit('error', errorWith('EACCES'));
        }, 40);
      }),
      20,
    ).probe(1025);
    deepStrictEqual(answer, 'timedOut');
  });

  it('§W1: an error other than an address in use answers error', async () => {
    const answer = await proberOver(
      scriptedServer(server => {
        queueMicrotask(() => {
          server.emit('error', errorWith('EACCES'));
        });
      }),
      5000,
    ).probe(1025);
    deepStrictEqual(answer, 'error');
  });

  it('§W1: an address in use answers once, and a later error changes nothing', async () => {
    const answer = await proberOver(
      scriptedServer(server => {
        queueMicrotask(() => {
          server.emit('error', errorWith('EADDRINUSE'));
          queueMicrotask(() => {
            server.emit('error', errorWith('EACCES'));
          });
        });
      }),
      5000,
    ).probe(1025);
    deepStrictEqual(answer, 'open');
  });

  it('§W1: errors before and after the timer are both heard', async () => {
    const answer = await proberOver(
      scriptedServer(server => {
        setTimeout(() => {
          server.emit('error', errorWith('EACCES'));
        }, 10);
        setTimeout(() => {
          server.emit('error', errorWith('ECONNRESET'));
        }, 30);
      }),
      20,
    ).probe(1025);
    deepStrictEqual(answer, 'error');
  });

  it('§W1: an error after a free answer is heard', async () => {
    const servers2: Server[] = [];
    const answer = await proberOver(() => {
      const server = createServer();
      servers2.push(server);
      return server;
    }, 5000).probe(await releasedPort());
    servers2[0]?.emit('error', errorWith('EACCES'));
    deepStrictEqual(answer, 'refused');
  });

  it('§W1, F-2104 BR-7: the search over the real prober skips the taken port', async () => {
    const taken = await listeningServer();
    const outcome = await findFreePort(nodePortProber(), {
      first: taken,
      last: taken + 200,
    });
    deepStrictEqual('port' in outcome && outcome.port > taken, true);
  });

  it('§W1, F-2104 BR-7: the default probe timeout is 500 milliseconds, under the search budget', () => {
    deepStrictEqual(PROBE_TIMEOUT_MILLISECONDS, 500);
  });
});
