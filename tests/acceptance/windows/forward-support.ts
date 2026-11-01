/**
 * @fileoverview What the rows that use a forwarded port share: a connection to a local port that is held open after the
 * listener's greeting, and the programs that open the connections to a port of the host.
 */

import {connect} from 'node:net';
import {onHost} from './harness.ts';

/** A connection through a forward that has been greeted, and is held open until `release`. */
export interface Held {
  greeting: string;
  release(): void;
}

/** Connects to a local port and gives the listener's greeting, keeping the connection open. */
export function holdOpen(port: number): Promise<Held> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('data', (chunk: Buffer) => {
      resolve({
        greeting: chunk.toString('utf8').trim(),
        release: () => {
          socket.destroy();
        },
      });
    });
    socket.on('error', reject);
  });
}

/** The program column of each host connection to the listener's port, from the side that opened it. */
export async function connectingPrograms(
  remotePort: number,
): Promise<string[]> {
  const table = await onHost('netstat', '-tnp');
  return table
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(
      columns =>
        columns.includes('ESTABLISHED') &&
        columns[4] === `127.0.0.1:${String(remotePort)}`,
    )
    .map(columns => columns.slice(6).join(' '));
}
