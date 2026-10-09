/**
 * @fileoverview What a window knows of its connection: the target being resolved, where the attempt stands, and
 * whether the first resolve of the extension host has settled. Events drive it; it reads no clock and starts no
 * timer.
 */

import type {DecodedTarget} from '../codecs/types.ts';

/** Where the window's connection stands. */
export type ConnectionState =
  'resolving' | 'connected' | 'failed' | 'transportLost' | 'transportClosed';

/** What happens to the connection, as the resolver host and the connector report it. */
export type ConnectionEvent =
  | {kind: 'resolveStarted'; target: DecodedTarget; attempt: number}
  | {kind: 'resolveSucceeded'}
  | {kind: 'resolveFailed'}
  | {kind: 'transportLost'}
  | {kind: 'transportClosed'};

/** The window's connection: its target, its state and the attempt that state belongs to. */
export interface CurrentConnection {
  target: DecodedTarget;
  state: ConnectionState;
  attempt: number;
}

/** What applying an event did. */
export interface Applied {
  /** Whether the event was applied: the state, the target and the attempt are now the event's. */
  changed: boolean;
  /** True exactly once: on the first resolve that settles, in success or in failure. */
  firstResolveSettled: boolean;
}

/** The states an event may follow; an event in any other state is ignored. */
const SOURCES: Readonly<
  Record<
    Exclude<ConnectionEvent['kind'], 'resolveStarted'>,
    readonly ConnectionState[]
  >
> = {
  resolveSucceeded: ['resolving'],
  resolveFailed: ['resolving'],
  transportLost: ['connected'],
  transportClosed: ['connected', 'transportLost'],
};

/** The state an event leads to. */
const TARGETS: Readonly<
  Record<Exclude<ConnectionEvent['kind'], 'resolveStarted'>, ConnectionState>
> = {
  resolveSucceeded: 'connected',
  resolveFailed: 'failed',
  transportLost: 'transportLost',
  transportClosed: 'transportClosed',
};

/** Follows the events of one window's connection. */
export class ConnectionTracker {
  private connection: CurrentConnection | undefined;
  private settled = false;
  private readonly listeners = new Set<
    (current: CurrentConnection | undefined) => void
  >();

  /** The connection, or nothing before the first resolve starts. */
  current(): Readonly<CurrentConnection> | undefined {
    return this.connection;
  }

  /** Applies an event, ignoring one that does not follow the current state, and tells the listeners of a change. */
  apply(event: ConnectionEvent): Applied {
    if (event.kind === 'resolveStarted') {
      this.connection = {
        target: event.target,
        state: 'resolving',
        attempt: event.attempt,
      };
      return this.announce(false);
    }
    const connection = this.connection;
    if (
      connection === undefined ||
      !SOURCES[event.kind].includes(connection.state)
    ) {
      return {changed: false, firstResolveSettled: false};
    }
    this.connection = {...connection, state: TARGETS[event.kind]};
    const settling =
      event.kind === 'resolveSucceeded' || event.kind === 'resolveFailed';
    const first = settling && !this.settled;
    this.settled ||= settling;
    return this.announce(first);
  }

  /** Calls `listener` after every change; the function it returns stops the calls. */
  onChange(
    listener: (current: CurrentConnection | undefined) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private announce(firstResolveSettled: boolean): Applied {
    for (const listener of this.listeners) {
      listener(this.connection);
    }
    return {changed: true, firstResolveSettled};
  }
}
