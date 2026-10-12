/**
 * @fileoverview The window tunnel's named bounds: how long a tunnel waits to be ready, how often it tries meanwhile,
 * how much a client may send before the host side opens, and how long the relay may take to open one connection.
 */

import type {WaitLimits} from './wait.ts';

/** Ten seconds for the tunnel to answer, tried every tenth of a second, with sixteen mebibytes held per client. */
export const TUNNEL_WAIT_LIMITS: WaitLimits = {
  readyMilliseconds: 10 * 1000,
  retryMilliseconds: 100,
  heldBytesMaximum: 16 * 1024 * 1024,
};

/** How long the relay may take to open one connection, from the greeting to its reply. */
export const SOCKS_HANDSHAKE_MILLISECONDS = 10 * 1000;
