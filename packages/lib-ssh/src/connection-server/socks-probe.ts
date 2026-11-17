/**
 * @fileoverview The probe of a shared session that never queues behind a run on it: a SOCKS connect through the
 * helper's dynamic forward to the host's loopback. `ssh` answers a SOCKS client's connect only once the host's sshd has
 * answered the channel it opened for it, so any reply, a refusal included, shows the session carries traffic.
 */

import {connect} from 'node:net';
import type {Scheduler} from 'lib-helper';

/** What a probe connects to and how long it waits for a reply. */
export interface SocksProbeRequest {
  /** The loopback port of the helper's SOCKS forward. */
  socksPort: number;
  /** The port on the host's loopback the connect names. */
  targetPort: number;
  deadlineMilliseconds: number;
}

/** Whether the session answered: true for any reply to the connect, false for none in time or a SOCKS port that refuses. */
export type SocksProbe = (request: SocksProbeRequest) => Promise<boolean>;

/** The greeting of a SOCKS5 client that offers no authentication. */
const GREETING = Buffer.from([5, 1, 0]);

/** The connect request for the IPv4 address 127.0.0.1 at `port`. */
function connectRequest(port: number): Buffer {
  return Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, port >> 8, port & 255]);
}

/** The probe over real sockets, with its deadline kept by `scheduler`. */
export function socksProbeOver(scheduler: Scheduler): SocksProbe {
  return ({socksPort, targetPort, deadlineMilliseconds}) =>
    new Promise(resolve => {
      const socket = connect({host: '127.0.0.1', port: socksPort});
      let requested = false;
      function finish(alive: boolean): void {
        cancel();
        socket.destroy();
        resolve(alive);
      }
      const cancel = scheduler.setTimer(deadlineMilliseconds, () => {
        finish(false);
      });
      socket.on('connect', () => {
        socket.write(GREETING);
      });
      socket.on('data', () => {
        // The first answer is to the greeting, which ssh gives at once; the reply to the connect is the second.
        if (requested) {
          finish(true);
          return;
        }
        requested = true;
        socket.write(connectRequest(targetPort));
      });
      socket.on('error', () => {
        finish(false);
      });
      socket.on('close', () => {
        finish(false);
      });
    });
}
