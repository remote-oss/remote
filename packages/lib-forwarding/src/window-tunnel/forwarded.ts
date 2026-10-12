/**
 * @fileoverview The window tunnel of a second `ssh -N -L` session: that session owns the window's port, so this
 * library only waits until the port accepts a connection, within the bound, and hands back the address.
 */

import type {Scheduler} from 'lib-helper';
import type {LocalPort} from './ports.ts';
import type {WindowTunnelOutcome} from './relay.ts';
import {succeedsWithin, type WaitLimits} from './wait.ts';

/** Everything a forwarded tunnel is made from. */
export interface ForwardedTunnelRequest {
  local: LocalPort;
  scheduler: Scheduler;
  /** The port the second session forwards on this machine's loopback. */
  localPort: number;
  limits: WaitLimits;
  /** Ends the second session; called when the tunnel is closed or never became ready. */
  stopSession(): void;
}

/** Waits for the second session's port to accept a connection; `tunnelNotReady` at the bound ends the session. */
export async function openForwardedTunnel(
  request: ForwardedTunnelRequest,
): Promise<WindowTunnelOutcome> {
  const ready = await succeedsWithin(
    async () => {
      (await request.local.connect(request.localPort)).close();
    },
    request.limits,
    request.scheduler,
  );
  if (!ready) {
    request.stopSession();
    return {kind: 'tunnelNotReady'};
  }
  return {
    kind: 'open',
    address: {host: '127.0.0.1', port: request.localPort},
    close: () => {
      request.stopSession();
    },
    onClosed: () => undefined,
  };
}
