/**
 * @fileoverview The endpoint port on Node.js: a Unix socket that only the user can open, one JSON value per line.
 * The Windows named pipe is provisional and refuses until it has been run on Windows.
 */

import {createConnection, createServer, type Socket} from 'node:net';
import type {
  EndpointConnection,
  EndpointPort,
  EndpointServer,
} from './protocol.ts';

/** The mask under which the socket file is created: read and write for the user only, mode 0600. */
const OWNER_ONLY_MASK = 0o177;

/** A connection over `socket`: one JSON value per line; a broken or non-JSON stream ends it. */
export function lineConnection(socket: Socket): EndpointConnection {
  const messageListeners: Array<(message: unknown) => void> = [];
  const closeListeners: Array<() => void> = [];
  let buffered = '';
  let closed = false;
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    const lastEnd = buffered.lastIndexOf('\n');
    if (lastEnd < 0) {
      return;
    }
    const lines = buffered.slice(0, lastEnd).split('\n');
    buffered = buffered.slice(lastEnd + 1);
    for (const line of lines) {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        // A line that is not JSON breaks the protocol, so the connection ends.
        socket.destroy();
        return;
      }
      for (const listener of messageListeners) {
        listener(message);
      }
    }
  });
  // A socket emits 'close' once, after its last 'data'.
  function closeOnce(): void {
    closed = true;
    for (const listener of closeListeners) {
      listener();
    }
  }
  socket.on('close', closeOnce);
  socket.on('error', () => {
    socket.destroy();
  });
  return {
    send: message => {
      if (!closed) {
        socket.write(`${JSON.stringify(message)}\n`);
      }
    },
    onMessage: listener => {
      messageListeners.push(listener);
    },
    onClose: listener => {
      closeListeners.push(listener);
    },
    // Ends our side after what was sent is flushed, then destroys the socket, so that a peer which never ends its
    // own side cannot keep the connection, and with it the server, open.
    close: () => {
      socket.end(() => {
        socket.destroy();
      });
    },
  };
}

/** The answer of every endpoint call on Windows until the named pipe has been run there. */
function refuseProvisional(): Promise<never> {
  return Promise.reject(
    new Error(
      'helper endpoints on Windows (named pipes) are not available yet',
    ),
  );
}

/** The endpoint port of this platform; on Windows every call rejects as provisional. */
export function nodeEndpointPort(
  platform: string = process.platform,
): EndpointPort {
  if (platform === 'win32') {
    return {listen: refuseProvisional, connect: refuseProvisional};
  }
  return {
    listen: (endpoint, onConnection) =>
      new Promise<EndpointServer>((resolve, reject) => {
        const server = createServer(socket => {
          onConnection(lineConnection(socket));
        });
        // The mask is process-wide while the listen is pending, which a single-purpose helper process can bear.
        const previousMask = process.umask(OWNER_ONLY_MASK);
        server.once('error', error => {
          process.umask(previousMask);
          reject(error);
        });
        server.listen(endpoint, () => {
          process.umask(previousMask);
          resolve({
            close: () =>
              new Promise<void>(closed => {
                server.close(() => {
                  closed();
                });
              }),
          });
        });
      }),
    connect: endpoint =>
      new Promise<EndpointConnection>((resolve, reject) => {
        const socket = createConnection(endpoint);
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.off('error', reject);
          resolve(lineConnection(socket));
        });
      }),
  };
}
