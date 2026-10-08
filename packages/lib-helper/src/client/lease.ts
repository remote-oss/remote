/**
 * @fileoverview A lease on a helper as its client holds it: one connection, its requests and its events.
 */

import type {
  EndpointConnection,
  HelperMessage,
  PlainData,
} from '../endpoint/protocol.ts';

/** What a helper tells its leases. */
export type HelperEvent =
  | {kind: 'message'; body: PlainData}
  | {kind: 'leaseListChanged'; leases: number[]}
  | {kind: 'helperGone'};

/** How a request ended. */
export type RequestOutcome =
  | {kind: 'reply'; body: PlainData}
  | {kind: 'rejected'; reason: string}
  | {kind: 'helperGone'}
  | {kind: 'timeout'};

/** Waits the given number of milliseconds; the returned function cancels the wait. */
export type Timer = (milliseconds: number, callback: () => void) => () => void;

/** A client's lease on a running helper. */
export class HelperLease {
  /** The lease's number at the helper. */
  readonly leaseId: number;
  /** The helper's record payload. */
  readonly payload: Record<string, string | number | boolean>;
  /** Whether this client's claim started the helper. */
  readonly startedByMe: boolean;
  private readonly connection: EndpointConnection;
  private readonly timer: Timer;
  private readonly pending = new Map<
    number,
    (outcome: RequestOutcome) => void
  >();
  private readonly listeners = new Set<(event: HelperEvent) => void>();
  private liveLeases: number[];
  private lastRequestId = 0;
  private gone = false;
  private released = false;

  /** A lease over `connection`, after the helper's welcome. */
  constructor(
    connection: EndpointConnection,
    welcome: Extract<HelperMessage, {type: 'welcome'}>,
    startedByMe: boolean,
    timer: Timer,
  ) {
    this.connection = connection;
    this.leaseId = welcome.lease;
    this.payload = welcome.payload;
    this.liveLeases = welcome.leases;
    this.startedByMe = startedByMe;
    this.timer = timer;
    connection.onMessage(message => {
      // A helper of this library sends only its own messages.
      this.receive(message as HelperMessage);
    });
    connection.onClose(() => {
      this.gone = true;
      for (const settle of this.pending.values()) {
        settle({kind: 'helperGone'});
      }
      this.pending.clear();
      if (!this.released) {
        this.emit({kind: 'helperGone'});
      }
    });
  }

  /** The lease's place among the live leases, oldest first: 0 for the oldest. */
  position(): number {
    return this.liveLeases.indexOf(this.leaseId);
  }

  /** Sends a request and waits for its reply up to the caller's limit. */
  request(body: PlainData, limitMilliseconds: number): Promise<RequestOutcome> {
    if (this.gone) {
      return Promise.resolve({kind: 'helperGone'});
    }
    this.lastRequestId += 1;
    const requestId = this.lastRequestId;
    return new Promise(resolve => {
      const cancel = this.timer(limitMilliseconds, () => {
        this.pending.delete(requestId);
        resolve({kind: 'timeout'});
      });
      this.pending.set(requestId, outcome => {
        cancel();
        resolve(outcome);
      });
      this.connection.send({type: 'request', requestId, body});
    });
  }

  /** Calls `listener` for each event of the helper; the returned function stops it. */
  onEvent(listener: (event: HelperEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Ends the lease; the helper sees the closed connection as the release. */
  release(): void {
    this.released = true;
    this.connection.close();
  }

  private receive(message: HelperMessage): void {
    switch (message.type) {
      case 'reply':
      case 'failed': {
        const settle = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        settle?.(
          message.type === 'reply'
            ? {kind: 'reply', body: message.body}
            : {kind: 'rejected', reason: message.reason},
        );
        return;
      }
      case 'leaseListChanged':
        this.liveLeases = message.leases;
        this.emit({kind: 'leaseListChanged', leases: message.leases});
        return;
      case 'message':
        this.emit({kind: 'message', body: message.body});
        return;
      default:
        return;
    }
  }

  private emit(event: HelperEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
