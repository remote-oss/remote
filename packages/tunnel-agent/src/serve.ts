/**
 * @fileoverview Serving the tunnel: the host leg is held until the user stops the agent, or until it ends for good. A
 * leg that ends for good ends the run with a status that is not zero, so that the service manager starts the agent
 * again and it finds its tunnel anew.
 */

import type {RelayTunnel} from './relay.ts';

/** How the host leg ended. */
export type HostEnd =
  {kind: 'stopped'} | {kind: 'otherHost'} | {kind: 'ended'; reason: string};

/** The host leg of a tunnel. */
export interface HostLeg {
  /**
   * Holds the leg for `tunnel` until `stop` is signalled, which closes it once, or until it ends for good: the relay's
   * reconnection in place is the leg's own.
   */
  hold(tunnel: RelayTunnel, stop: AbortSignal): Promise<HostEnd>;
}

/** Serves `tunnel` through `leg` until it ends; the exit status of the run, after the user was told why it ended. */
export async function serveTunnel(
  hostLeg: HostLeg,
  tunnel: RelayTunnel,
  stop: AbortSignal,
  report: (line: string) => void,
): Promise<number> {
  const end = await hostLeg.hold(tunnel, stop);
  if (end.kind === 'stopped') {
    return 0;
  }
  report(
    end.kind === 'otherHost'
      ? 'another host has taken this tunnel; this agent stops'
      : `the host leg ended: ${end.reason}`,
  );
  return 1;
}
