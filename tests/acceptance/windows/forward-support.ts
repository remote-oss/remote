/**
 * @fileoverview What the rows that use a forwarded port share: a connection to a local port that is held open after the
 * listener's greeting, and the programs that open the connections to a port of the host.
 */

import {connect} from 'node:net';
import {
  type ForwardedTunnel,
  inWindow,
  onHost,
  tunnelsOf,
  waitFor,
} from './harness.ts';
import {answerInputBox} from './renderer.ts';

/** The command that shows core's Ports view. */
const FOCUS_PORTS = '~remote.forwardedPorts.focus';

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

/** Starts a listener on the host's loopback `port` that answers with `greeting`, outside VS Code. */
export async function listenOnHost(
  port: number,
  greeting: string,
): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `nc -lk -p ${String(port)} -s 127.0.0.1 -e /bin/echo ${greeting} >/dev/null 2>&1 &`,
  );
}

/** The local port of a tunnel's local address, `<host>:<port>`. */
export function localPortOf(tunnel: ForwardedTunnel): number {
  return Number(
    tunnel.localAddress.slice(tunnel.localAddress.lastIndexOf(':') + 1),
  );
}

/** Waits until window `name` forwards remote `port`, and gives that tunnel. */
export async function tunnelFor(
  name: string,
  port: number,
  milliseconds = 30_000,
): Promise<ForwardedTunnel> {
  let found: ForwardedTunnel | undefined;
  await waitFor(
    `window ${name} to forward port ${String(port)}`,
    async () => {
      found = (await tunnelsOf(name)).find(
        tunnel => tunnel.remotePort === port,
      );
      return found !== undefined;
    },
    milliseconds,
  );
  return found ?? {remotePort: port, localAddress: ''};
}

/** Shows core's Ports view in window `name`. */
export async function showPorts(name: string): Promise<void> {
  await waitFor(
    'core to register the Ports view',
    async () => {
      try {
        await inWindow(name, FOCUS_PORTS);
        return true;
      } catch {
        return false;
      }
    },
    30_000,
  );
}

/** Forwards `port` of the window by hand, as a user does with Forward a Port. */
export async function forwardByHand(
  window: string,
  port: number,
): Promise<void> {
  const forwarding = inWindow(window, 'remote.tunnel.forwardCommandPalette');
  await answerInputBox(window, String(port));
  await forwarding;
}
