/**
 * @fileoverview The proxy's data socket: an owner-only socket beside its endpoint where a window collects a stream it
 * was promised. The proxy issues a one-time ticket for each stream; a connection that first writes a live ticket and a
 * line end is joined to that stream both ways, and any other connection is closed. A ticket lives ten seconds and
 * serves once.
 */

import {randomBytes} from 'node:crypto';
import {chmod} from 'node:fs/promises';
import {createServer, type Server, type Socket} from 'node:net';
import type {Duplex} from 'node:stream';

/** How long a ticket waits for its window, in milliseconds. */
const TICKET_MILLISECONDS = 10_000;

/** The longest first line a connection may send before its ticket is read. */
const LONGEST_TICKET_LINE = 65;

/** A stream waiting for the window that holds its ticket. */
interface Waiting {
  stream: Duplex;
  timer: NodeJS.Timeout;
}

/** The data socket of one proxy. */
export class DataSocket {
  private readonly waiting = new Map<string, Waiting>();
  private readonly connections = new Set<Socket>();
  private readonly server: Server;
  private readonly ticketMilliseconds: number;
  /** Where the socket listens: a path, or a named pipe on Windows. */
  readonly address: string;

  private constructor(
    server: Server,
    address: string,
    ticketMilliseconds: number,
  ) {
    this.server = server;
    this.address = address;
    this.ticketMilliseconds = ticketMilliseconds;
  }

  /** Listens at `address`, owner-only where the platform has file modes; a ticket lives `ticketMilliseconds`. */
  static async listen(
    address: string,
    platform: string,
    ticketMilliseconds = TICKET_MILLISECONDS,
  ): Promise<DataSocket> {
    const server = createServer();
    const socket = new DataSocket(server, address, ticketMilliseconds);
    server.on('connection', connection => {
      socket.admit(connection);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (platform !== 'win32') {
      await chmod(address, 0o600);
    }
    return socket;
  }

  /** A ticket for `stream`, which the stream waits on until it is used or lapses; a lapsed stream is destroyed. */
  issue(stream: Duplex): string {
    // A stream torn down before or after its window joins it ends there: its error goes nowhere else.
    stream.on('error', () => stream.destroy());
    const ticket = randomBytes(32).toString('hex');
    const timer = setTimeout(() => {
      this.waiting.delete(ticket);
      stream.destroy();
    }, this.ticketMilliseconds);
    this.waiting.set(ticket, {stream, timer});
    return ticket;
  }

  /** Stops listening and destroys every stream still waiting. */
  close(): Promise<void> {
    for (const {stream, timer} of this.waiting.values()) {
      clearTimeout(timer);
      stream.destroy();
    }
    this.waiting.clear();
    for (const connection of this.connections) {
      connection.destroy();
    }
    return new Promise(resolve => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  /** Reads a connection's ticket line, then joins it to its stream, or closes it. */
  private admit(connection: Socket): void {
    this.connections.add(connection);
    connection.on('close', () => this.connections.delete(connection));
    connection.on('error', () => connection.destroy());
    let read = '';
    const onData = (chunk: Buffer): void => {
      read += chunk.toString('latin1');
      const end = read.indexOf('\n');
      if (end < 0) {
        if (read.length > LONGEST_TICKET_LINE) {
          connection.destroy();
        }
        return;
      }
      connection.off('data', onData);
      const found = this.waiting.get(read.slice(0, end));
      if (found === undefined) {
        connection.destroy();
        return;
      }
      this.waiting.delete(read.slice(0, end));
      clearTimeout(found.timer);
      const rest = Buffer.from(read.slice(end + 1), 'latin1');
      if (rest.length > 0) {
        found.stream.write(rest);
      }
      connection.pipe(found.stream).pipe(connection);
      connection.on('close', () => found.stream.destroy());
      found.stream.on('close', () => connection.destroy());
    };
    connection.on('data', onData);
  }
}
