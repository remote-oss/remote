/**
 * @fileoverview The window tunnel of a second `ssh -N -L` session: that session owns the window's port, so this
 * library only waits until the port accepts a connection, within the bound, and hands back the address. A request may
 * also ask whether the forward carries a connection: the session closes a connection of the port at once when the host
 * refuses the forward it was set up with.
 */

import type {Scheduler} from 'lib-helper';
import type {Duplex, LocalPort} from './ports.ts';
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
  /**
   * How long the connection that proved the port accepting stays open before the forward counts as carrying it, in
   * milliseconds. Absent, the connection is closed at once and a refused forward goes unseen.
   */
  refusalMilliseconds?: number;
}

/** Whether `connection` was closed by the other end within `milliseconds`; it is closed here when it was not. */
function closedWithin(
  connection: Duplex,
  milliseconds: number,
  scheduler: Scheduler,
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let settled = false;
    const cancel = scheduler.setTimer(milliseconds, () => {
      settled = true;
      connection.close();
      resolve(false);
    });
    connection.onClose(() => {
      if (!settled) {
        settled = true;
        cancel();
        resolve(true);
      }
    });
  });
}

/** Waits for the second session's port to accept a connection; `tunnelNotReady` at the bound ends the session. */
export async function openForwardedTunnel(
  request: ForwardedTunnelRequest,
): Promise<WindowTunnelOutcome> {
  const {refusalMilliseconds} = request;
  let held: Duplex | undefined;
  const ready = await succeedsWithin(
    async () => {
      const connection = await request.local.connect(request.localPort);
      if (refusalMilliseconds === undefined) {
        connection.close();
      } else {
        held = connection;
      }
    },
    request.limits,
    request.scheduler,
  );
  if (!ready) {
    request.stopSession();
    return {kind: 'tunnelNotReady'};
  }
  if (
    held !== undefined &&
    refusalMilliseconds !== undefined &&
    (await closedWithin(held, refusalMilliseconds, request.scheduler))
  ) {
    request.stopSession();
    return {kind: 'forwardRefused'};
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
