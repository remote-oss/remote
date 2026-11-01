/**
 * @fileoverview What the rows of the default-ports launch share: listeners on the host and on the client, the tunnels
 * of a window, and core's Ports view.
 */

import {createServer, type Server} from 'node:net';
import {
  type ForwardedTunnel,
  inWindow,
  onHost,
  tunnelsOf,
  waitFor,
} from '../windows/harness.ts';

/** The command that shows core's Ports view. */
const FOCUS_PORTS = '~remote.forwardedPorts.focus';

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

/** Starts a listener on the host's loopback `port` that greets and then keeps each connection open for a while. */
export async function listenHoldingOnHost(
  port: number,
  greeting: string,
): Promise<void> {
  const greeter = `/tmp/c83-greeter-${String(port)}.sh`;
  await onHost(
    'sh',
    '-c',
    `printf '#!/bin/sh\\necho ${greeting}\\nsleep 30\\n' > ${greeter} && chmod 755 ${greeter}`,
  );
  await onHost(
    'sh',
    '-c',
    `nohup nc -lk -p ${String(port)} -s 127.0.0.1 -e ${greeter} >/dev/null 2>&1 &`,
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

/** Holds the client's local `port` on `address` (its IPv4 loopback by default) until the returned function is called. */
export async function holdLocal(
  port: number,
  address = '127.0.0.1',
): Promise<() => Promise<void>> {
  const holder: Server = createServer();
  await new Promise<void>((resolve, reject) => {
    holder.once('error', reject);
    holder.listen(port, address, resolve);
  });
  return () =>
    new Promise(resolve => {
      holder.close(() => {
        resolve();
      });
    });
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
