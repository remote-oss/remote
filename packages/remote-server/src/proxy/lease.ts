/**
 * @fileoverview A window's hold on the profile's local proxy: what the resolver, the ports and the limits ask of it.
 * The proxy client gives one over the proxy's endpoint; rows use the fake in `testing/fake-proxy.ts`.
 */

import type {Duplex} from 'node:stream';
import type {PlainData} from 'lib-helper';
import type {OpenFailureReason} from './messages.ts';

/** A stream to a tunnel's port, or why there is none. */
export type OpenOutcome =
  | {kind: 'opened'; stream: Duplex}
  | {kind: 'failed'; reason: OpenFailureReason; detail: string};

/** A window's lease on the local proxy. */
export interface ProxyLease {
  /** A byte stream to port `port` of tunnel `tunnelName`, through the proxy's client leg. */
  open(tunnelName: string, port: number): Promise<OpenOutcome>;
  /** The `serve` result the proxy keeps for `tunnelName`, or null when no window has served it yet. */
  serveKept(tunnelName: string): Promise<PlainData | null>;
  /** Keeps `served` for `tunnelName`; false when the proxy keeps one already, which then stays. */
  keepServe(tunnelName: string, served: PlainData): Promise<boolean>;
  /** Gives the lease back; the proxy ends a minute after the profile's last tunnel window gives its back. */
  release(): void;
}
