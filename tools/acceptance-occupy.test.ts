import {deepStrictEqual} from 'node:assert';
import {createConnection, createServer, type Server} from 'node:net';
import {holdClientPorts} from './acceptance-occupy.ts';

/** Whether a connection to the loopback port is accepted. */
function accepted(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({port, host: '127.0.0.1'});
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

/** Starts a server on a free loopback port. */
function started(): Promise<Server> {
  const server = createServer();
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

/** The port a started server listens on. */
function portOf(server: Server): number {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
}

/** Stops a server. */
function stopped(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => {
      resolve();
    });
  });
}

describe('the client ports held while a launch runs', () => {
  it('#680: held ports accept connections until they are released', async () => {
    const probe = await started();
    const port = portOf(probe);
    await stopped(probe);
    const held = await holdClientPorts([port]);
    const during = await accepted(port);
    await held.release();
    deepStrictEqual([during, await accepted(port)], [true, false]);
  });

  it('#680: a port that is taken fails naming it, and frees the ports held before it', async () => {
    const probe = await started();
    const free = portOf(probe);
    await stopped(probe);
    const taken = await started();
    const takenPort = portOf(taken);
    let message = '';
    await holdClientPorts([free, takenPort]).catch((caught: unknown) => {
      message = caught instanceof Error ? caught.message : String(caught);
    });
    const afterwards = await accepted(free);
    await stopped(taken);
    deepStrictEqual(
      [
        message.startsWith(
          `the client listener on 127.0.0.1:${String(takenPort)} could not start:`,
        ),
        afterwards,
      ],
      [true, false],
    );
  });

  it('#680: the ports are held on 127.0.0.1 and not on every address', async () => {
    const probe = await started();
    const port = portOf(probe);
    await stopped(probe);
    const neighbour = createServer();
    await new Promise<void>(resolve => {
      neighbour.listen(port, '127.0.0.2', () => {
        resolve();
      });
    });
    const held = await holdClientPorts([port]).catch((caught: unknown) =>
      caught instanceof Error ? caught : new Error(String(caught)),
    );
    const accepting = await accepted(port);
    if ('release' in held) {
      await held.release();
    }
    await stopped(neighbour);
    deepStrictEqual([held instanceof Error, accepting], [false, true]);
  });
});
