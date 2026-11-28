/**
 * @fileoverview The proxy's answers to its windows: it keeps the latest window's sign-in and proxy settings, opens a
 * stream to a tunnel's port and hands it out on the data socket for a one-time ticket, and keeps the first `serve`
 * result of each tunnel for the windows after it. The tunnel connections are behind `TunnelLegs`.
 */

import type {Duplex} from 'node:stream';
import type {MessageHandler, PlainData} from 'lib-helper';
import {
  type OpenFailureReason,
  type ProxyReply,
  type ProxyRequest,
  readProxyRequest,
} from 'lib-tunnels';

/** What a window gave the proxy to reach the relay with. */
export type Access = Omit<Extract<ProxyRequest, {type: 'attach'}>, 'type'>;

/** A stream to a tunnel's port, or why there is none. */
export type LegOutcome =
  | {kind: 'stream'; stream: Duplex}
  | {kind: 'failed'; reason: OpenFailureReason; detail: string};

/** The proxy's connections to its tunnels. */
export interface TunnelLegs {
  /** A stream to port `port` of the tunnel named `tunnelName`, signed in with `access`. */
  stream(tunnelName: string, port: number, access: Access): Promise<LegOutcome>;
}

/** Where windows collect their streams. */
export interface TicketDesk {
  /** The data socket's address. */
  readonly address: string;
  /** A one-time ticket for `stream`. */
  issue(stream: Duplex): string;
}

/** The proxy's message handler. */
export class ProxyHandler implements MessageHandler {
  private readonly legs: TunnelLegs;
  private readonly desk: TicketDesk;
  private readonly kept = new Map<string, PlainData>();
  private access: Access | undefined;

  /** A handler over `legs`, handing streams out at `desk`. */
  constructor(legs: TunnelLegs, desk: TicketDesk) {
    this.legs = legs;
    this.desk = desk;
  }

  /** Answers one request of a window. */
  async onRequest(body: PlainData): Promise<PlainData> {
    const request = readProxyRequest(body);
    if (request === undefined) {
      throw new Error('not a proxy request');
    }
    return this.answer(request);
  }

  /** The proxy has no end action. */
  runAction(): Promise<void> {
    return Promise.resolve();
  }

  private async answer(request: ProxyRequest): Promise<ProxyReply> {
    if (request.type === 'attach') {
      this.access = {token: request.token, proxy: request.proxy};
      return {type: 'attached'};
    }
    if (request.type === 'open') {
      return this.open(request.tunnelName, request.port);
    }
    const earlier = this.kept.get(request.tunnelName);
    if (request.type === 'serveKept' || earlier !== undefined) {
      return {type: 'serve', served: earlier ?? null};
    }
    this.kept.set(request.tunnelName, request.served);
    return {type: 'accepted'};
  }

  private async open(tunnelName: string, port: number): Promise<ProxyReply> {
    if (this.access === undefined) {
      return {
        type: 'failed',
        reason: 'unauthorized',
        detail: 'no window has signed in to the proxy',
      };
    }
    const outcome = await this.legs.stream(tunnelName, port, this.access);
    if (outcome.kind === 'failed') {
      return {type: 'failed', reason: outcome.reason, detail: outcome.detail};
    }
    return {
      type: 'opened',
      socket: this.desk.address,
      ticket: this.desk.issue(outcome.stream),
    };
  }
}
