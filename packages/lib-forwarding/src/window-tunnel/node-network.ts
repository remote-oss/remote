/**
 * @fileoverview The machine's loopback on Node.js: listening on and connecting to ports of 127.0.0.1 only, with the
 * connections as `Duplex` values. A connection holds the bytes that arrive before its first data listener is
 * attached, an error ends it like a close, and back-pressure runs through `send`, `pause`, `resume` and `onDrain`.
 */

import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import type {Duplex, Listening, LocalPort} from './ports.ts';

/** The only address the library listens on or connects to. */
const LOOPBACK = '127.0.0.1';

/** The streams of a connection and how its end is told: what `streamDuplex` turns into a `Duplex`. */
export interface DuplexStreams {
  readable: Pick<NodeJS.ReadableStream, 'on' | 'pause' | 'resume'>;
  writable: {
    write(chunk: Uint8Array): boolean;
    on(event: 'drain', listener: () => void): unknown;
  };
  /** Registers the function the connection calls once, when it has ended. */
  whenEnded(listener: () => void): void;
  /** Ends the connection now. */
  destroy(): void;
}

/** A connection over `streams`, holding the bytes that come before its first data listener. */
export function streamDuplex(streams: DuplexStreams): Duplex {
  const closeListeners: Array<() => void> = [];
  let closed = false;
  streams.whenEnded(() => {
    closed = true;
    for (const listener of closeListeners) {
      listener();
    }
  });
  return {
    send: chunk => streams.writable.write(chunk),
    onDrain: listener => {
      streams.writable.on('drain', listener);
    },
    pause: () => {
      streams.readable.pause();
    },
    resume: () => {
      streams.readable.resume();
    },
    onData: listener => {
      streams.readable.on('data', (chunk: Buffer) => {
        listener(chunk);
      });
    },
    onClose: listener => {
      if (closed) {
        queueMicrotask(listener);
      } else {
        closeListeners.push(listener);
      }
    },
    close: () => {
      streams.destroy();
    },
  };
}

/** A connection over `socket`. */
function socketDuplex(socket: Socket): Duplex {
  // An error always ends in a close, which is how it is told.
  socket.on('error', () => undefined);
  return streamDuplex({
    readable: socket,
    writable: socket,
    whenEnded: listener => {
      socket.on('close', listener);
    },
    destroy: () => {
      socket.destroy();
    },
  });
}

/**
 * Listens with `server` on `port` of the loopback. An error before listening rejects; the first error after it is
 * told to `onFailure` and closes the server. Later errors, and errors after `close`, are not told.
 */
export function listenOn(
  server: Server,
  port: number,
  onConnection: (connection: Duplex) => void,
  onFailure: (detail: string) => void,
): Promise<Listening> {
  return new Promise((resolve, reject) => {
    server.on('connection', (socket: Socket) => {
      onConnection(socketDuplex(socket));
    });
    server.once('error', reject);
    server.listen(port, LOOPBACK, () => {
      server.off('error', reject);
      let ended = false;
      server.on('error', error => {
        if (!ended) {
          ended = true;
          server.close();
          onFailure(error.message);
        }
      });
      resolve({
        close: () => {
          ended = true;
          server.close();
        },
      });
    });
  });
}

/** The loopback of this machine over `node:net`. */
export function nodeLocalPort(): LocalPort {
  return {
    listen: (port, onConnection, onFailure) =>
      listenOn(createServer(), port, onConnection, onFailure),
    connect: port =>
      new Promise((resolve, reject) => {
        const socket = createConnection({host: LOOPBACK, port});
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.off('error', reject);
          resolve(socketDuplex(socket));
        });
      }),
  };
}
