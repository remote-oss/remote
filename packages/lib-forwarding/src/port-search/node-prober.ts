/**
 * @fileoverview The real port prober: one TCP connect to the loopback port answers whether the port is free — a
 * refusal means free, a connection means taken, and any other error or no answer in time is an error. The socket
 * keeps its error listener for its whole life, so no error of the probe is unheard. It never binds a port (§W1).
 */

import {createConnection, type Socket} from 'node:net';
import type {PortProber, ProbeAnswer} from './find.ts';

/** How long one probe waits for an answer before it counts as an error. */
export const PROBE_TIMEOUT_MILLISECONDS = 500;

/** A prober over `connect`, which starts a connection to a loopback port; it never binds a port (§W1). */
export function proberOver(
  connect: (port: number) => Socket,
  timeoutMilliseconds: number,
): PortProber {
  return {
    probe: port =>
      new Promise<ProbeAnswer>(resolve => {
        const socket = connect(port);
        let answered = false;
        let timer: NodeJS.Timeout | undefined = undefined;
        function finish(result: ProbeAnswer): void {
          if (answered) {
            return;
          }
          answered = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(result);
        }
        timer = setTimeout(() => {
          finish('error');
        }, timeoutMilliseconds);
        socket.once('connect', () => {
          finish('open');
        });
        socket.on('error', error => {
          const code = (error as NodeJS.ErrnoException).code;
          finish(code === 'ECONNREFUSED' ? 'refused' : 'error');
        });
      }),
  };
}

/** The prober over `node:net`: `127.0.0.1:<port>`, with the default timeout. */
export function nodePortProber(): PortProber {
  return proberOver(
    port => createConnection({host: '127.0.0.1', port}),
    PROBE_TIMEOUT_MILLISECONDS,
  );
}
