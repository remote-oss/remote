/**
 * @fileoverview What the rows of the default-ports launch share: listeners on the host that hold their connections, and
 * the client's held ports.
 */

import {createServer, type Server} from 'node:net';
import {onHost} from '../windows/harness.ts';

/** Starts a listener on the host's loopback `port` that answers a client's first line and then keeps each connection open for a while. */
export async function listenHoldingOnHost(
  port: number,
  greeting: string,
): Promise<void> {
  const greeter = `/tmp/c83-greeter-${String(port)}.sh`;
  await onHost(
    'sh',
    '-c',
    `printf '#!/bin/sh\\nread line\\necho ${greeting}\\nsleep 30\\n' > ${greeter} && chmod 755 ${greeter}`,
  );
  await onHost(
    'sh',
    '-c',
    `nohup nc -lk -p ${String(port)} -s 127.0.0.1 -e ${greeter} >/dev/null 2>&1 &`,
  );
}

/** Holds the client's local `port` on `address` (its IPv4 loopback by default) until the returned function is called. */
export async function holdLocal(
  port: number,
  address = '127.0.0.1',
): Promise<() => Promise<void>> {
  // The sockets it accepts are read to their end, so that a client that wrote to the port and left lets the holder close.
  const holder: Server = createServer(socket => {
    socket.on('error', () => undefined);
    socket.resume();
  });
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
