import {deepStrictEqual, rejects} from 'node:assert';
import {createServer} from 'node:net';
import {type Duplex, type Listening, nodeLocalPort} from '../../src/index.ts';

/** A port on the loopback that nothing listens on. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>(resolve => {
    server.close(() => {
      resolve();
    });
  });
  return typeof address === 'object' && address !== null ? address.port : 0;
}

/** Waits until `ready` holds, polling on the next turns of the event loop. */
async function until(ready: () => boolean): Promise<void> {
  for (let round = 0; round < 500 && !ready(); round++) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

/** The texts a connection delivers, in the order they arrive. */
function collected(connection: Duplex): string[] {
  const received: string[] = [];
  connection.onData(chunk => {
    received.push(Buffer.from(chunk).toString());
  });
  return received;
}

interface Pair {
  server: Duplex;
  client: Duplex;
  listening: Listening;
}

/** A client connected to a listening port, with the connection the listener got. */
async function pair(): Promise<Pair> {
  const network = nodeLocalPort();
  const port = await freePort();
  const accepted: Duplex[] = [];
  const listening = await network.listen(port, connection => {
    accepted.push(connection);
  });
  const client = await network.connect(port);
  await until(() => accepted.length > 0);
  const [server] = accepted;
  if (server === undefined) {
    throw new Error('no connection arrived');
  }
  return {server, client, listening};
}

describe('the loopback over node:net', () => {
  const open: Pair[] = [];
  async function connected(): Promise<Pair> {
    const made = await pair();
    open.push(made);
    return made;
  }
  afterEach(() => {
    for (const {server, client, listening} of open.splice(0)) {
      server.close();
      client.close();
      listening.close();
    }
  });

  it('carries bytes both ways', async () => {
    const {server, client} = await connected();
    const received = collected(server);
    client.send(Buffer.from('ping'));
    await until(() => received.length > 0);
    deepStrictEqual(received, ['ping']);
  });

  it('holds the bytes that arrive before the first data listener', async () => {
    const {server, client} = await connected();
    client.send(Buffer.from('early'));
    await new Promise(resolve => setTimeout(resolve, 30));
    const received = collected(server);
    await until(() => received.length > 0);
    deepStrictEqual(received, ['early']);
  });

  it('stops delivering bytes while paused and delivers them on resume', async () => {
    const {server, client} = await connected();
    const received = collected(server);
    server.pause();
    client.send(Buffer.from('later'));
    await new Promise(resolve => setTimeout(resolve, 30));
    const whilePaused = [...received];
    server.resume();
    await until(() => received.length > 0);
    deepStrictEqual([whilePaused, received], [[], ['later']]);
  });

  it('says to stop feeding it when it is full, and tells when it can take bytes again', async () => {
    const {server, client} = await connected();
    server.pause();
    let drained = false;
    client.onDrain(() => {
      drained = true;
    });
    let accepting = true;
    for (let round = 0; round < 400 && accepting; round++) {
      accepting = client.send(new Uint8Array(65536));
    }
    server.onData(() => undefined);
    server.resume();
    await until(() => drained);
    deepStrictEqual([accepting, drained], [false, true]);
  });

  it('tells the other end when one end closes', async () => {
    const {server, client} = await connected();
    let closed = false;
    server.onClose(() => {
      closed = true;
    });
    client.close();
    await until(() => closed);
    deepStrictEqual(closed, true);
  });

  it('tells a close listener that comes after the close', async () => {
    const {server} = await connected();
    server.close();
    await new Promise(resolve => setTimeout(resolve, 30));
    let told = false;
    server.onClose(() => {
      told = true;
    });
    await until(() => told);
    deepStrictEqual(told, true);
  });

  it('tells an error as a close', async () => {
    const {server, client} = await connected();
    let closed = false;
    client.onClose(() => {
      closed = true;
    });
    server.close();
    client.send(Buffer.from('into the void'));
    await until(() => closed);
    deepStrictEqual(closed, true);
  });

  it('refuses a connect to a port nobody listens on', async () => {
    await rejects(nodeLocalPort().connect(await freePort()));
  });

  it('refuses to listen on a port that is taken', async () => {
    const {listening} = await connected();
    const taken = await freePort();
    const first = await nodeLocalPort().listen(taken, () => undefined);
    await rejects(nodeLocalPort().listen(taken, () => undefined));
    first.close();
    listening.close();
  });
});
