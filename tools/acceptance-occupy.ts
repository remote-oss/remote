/**
 * @fileoverview Holds ports of this machine's loopback while a launch runs, so that a case can make a configured port
 * range busy for the editor under test: the editor's prober calls a port taken when a connection to it is accepted.
 */

import {createServer, type Server} from 'node:net';

/** What holding ports gives back: the way to let them go. */
export interface HeldPorts {
  release(): Promise<void>;
}

/** Holds ports of the client's loopback; replaced by a test. */
export type PortHolder = (ports: readonly number[]) => Promise<HeldPorts>;

/** Starts listening on one loopback port, closing every connection at once; fails naming the port. */
function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => {
      socket.destroy();
    });
    server.once('error', error => {
      reject(
        new Error(
          `the client listener on 127.0.0.1:${String(port)} could not start: ${error.message}`,
        ),
      );
    });
    server.listen(port, '127.0.0.1', () => {
      server.removeAllListeners('error');
      resolve(server);
    });
  });
}

/** Stops listening and waits until the port is free again. */
function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => {
      resolve();
    });
  });
}

/** Listens on every port of `ports` on 127.0.0.1; a port that cannot be had frees the ones held before it. */
export async function holdClientPorts(
  ports: readonly number[],
): Promise<HeldPorts> {
  const held: Server[] = [];
  try {
    for (const port of ports) {
      held.push(await listenOn(port));
    }
  } catch (error) {
    await Promise.all(held.map(closeServer));
    throw error;
  }
  return {
    release: async () => {
      await Promise.all(held.map(closeServer));
    },
  };
}
