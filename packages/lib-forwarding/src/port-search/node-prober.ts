/**
 * @fileoverview The real port prober: it tries to listen on the loopback port, the call the window tunnel's relay
 * makes, so the two agree. A listen that succeeds means free (the probe closes it at once), an address in use means
 * taken, any other error is an error and no answer in time a timeout. A port held by a connected socket, which a
 * connect would find refused, is taken here as it is for the relay. The probe keeps its error listener for its whole
 * life, so no error of the probe is unheard.
 */

import {createServer, type Server} from 'node:net';
import type {PortProber, ProbeAnswer} from './find.ts';

/** How long one probe waits for an answer before it counts as a timeout. */
export const PROBE_TIMEOUT_MILLISECONDS = 500;

/** A prober over `create`, which makes a server that is told to listen on a loopback port and closes at once. */
export function proberOver(
  create: () => Server,
  timeoutMilliseconds: number,
): PortProber {
  return {
    probe: port =>
      new Promise<ProbeAnswer>(resolve => {
        const server = create();
        let answered = false;
        let timer: NodeJS.Timeout | undefined = undefined;
        function finish(result: ProbeAnswer): void {
          if (answered) {
            return;
          }
          answered = true;
          clearTimeout(timer);
          server.close();
          resolve(result);
        }
        timer = setTimeout(() => {
          finish('timedOut');
        }, timeoutMilliseconds);
        server.once('listening', () => {
          finish('refused');
        });
        server.on('error', error => {
          const code = (error as NodeJS.ErrnoException).code;
          finish(code === 'EADDRINUSE' ? 'open' : 'error');
        });
        server.listen(port, '127.0.0.1');
      }),
  };
}

/** The prober over `node:net`: `127.0.0.1:<port>`, with the default timeout. */
export function nodePortProber(): PortProber {
  return proberOver(() => createServer(), PROBE_TIMEOUT_MILLISECONDS);
}
