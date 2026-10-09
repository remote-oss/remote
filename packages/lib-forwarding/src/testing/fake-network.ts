/**
 * @fileoverview Fakes for the window tunnel's ports: connections that record what they were sent, a dialer and a
 * loopback that answer from a script, and hooks to deliver bytes and incoming connections as the other end would.
 */

import type {
  Dialer,
  Duplex,
  Listening,
  LocalPort,
  TunnelTarget,
} from '../window-tunnel/ports.ts';

/** How a scripted operation ends: it works, it fails, or it never ends. */
export type Answer = 'work' | 'fail' | 'hang';

/** A connection that keeps what it was sent and lets a test play the other end. */
export class FakeConnection implements Duplex {
  /** The chunks this end was asked to send. */
  readonly sent: Uint8Array[] = [];
  /** Whether this end has been closed. */
  closed = false;
  private readonly dataListeners: Array<(chunk: Uint8Array) => void> = [];
  private readonly closeListeners: Array<() => void> = [];

  /** Keeps the chunk. */
  send(chunk: Uint8Array): void {
    this.sent.push(chunk);
  }

  /** Registers a listener for the bytes that arrive. */
  onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListeners.push(listener);
  }

  /** Registers a listener for the end of the connection. */
  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  /** Ends the connection once. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  /** Bytes arrive from the other end. */
  receive(chunk: Uint8Array): void {
    for (const listener of this.dataListeners) {
      listener(chunk);
    }
  }
}

/** The answer for the `count`-th call: the script's entry, and its last entry for every call after it. */
function answerAt(script: readonly Answer[], count: number): Answer {
  return script[Math.min(count, script.length - 1)] ?? 'work';
}

/** A dialer whose calls end as the script says, one entry per call. */
export class FakeDialer implements Dialer {
  /** The targets asked for, in order. */
  readonly dialed: TunnelTarget[] = [];
  /** The connections given, in order. */
  readonly connections: FakeConnection[] = [];
  private readonly script: readonly Answer[];

  /** A dialer that answers by `script`. */
  constructor(script: readonly Answer[] = ['work']) {
    this.script = script;
  }

  /** Records the target and ends as the script says. */
  dial(target: TunnelTarget): Promise<Duplex> {
    const answer = answerAt(this.script, this.dialed.length);
    this.dialed.push(target);
    if (answer === 'hang') {
      return new Promise<Duplex>(() => undefined);
    }
    if (answer === 'fail') {
      return Promise.reject(new Error('the dialer cannot reach the host'));
    }
    const connection = new FakeConnection();
    this.connections.push(connection);
    return Promise.resolve(connection);
  }
}

/** This machine's loopback: listening ends as the first script says, connecting as the second. */
export class FakeLocalPort implements LocalPort {
  /** The ports listened on, in order. */
  readonly listened: number[] = [];
  /** The ports connected to, in order. */
  readonly connected: number[] = [];
  /** The connections given to the callers of `connect`. */
  readonly probes: FakeConnection[] = [];
  /** The ports whose listening was closed, in order. */
  readonly closedPorts: number[] = [];
  private readonly listeners = new Map<number, (connection: Duplex) => void>();
  private readonly listenAnswer: Answer;
  private readonly connectScript: readonly Answer[];

  /** A loopback whose listening and connecting end as the scripts say. */
  constructor(
    listenAnswer: Answer = 'work',
    connectScript: readonly Answer[] = ['work'],
  ) {
    this.listenAnswer = listenAnswer;
    this.connectScript = connectScript;
  }

  /** Records the port and ends as the listen answer says. */
  listen(
    port: number,
    onConnection: (connection: Duplex) => void,
  ): Promise<Listening> {
    if (this.listenAnswer === 'fail') {
      return Promise.reject(new Error(`port ${String(port)} is in use`));
    }
    this.listened.push(port);
    this.listeners.set(port, onConnection);
    return Promise.resolve({
      close: () => {
        this.closedPorts.push(port);
        this.listeners.delete(port);
      },
    });
  }

  /** Records the port and ends as the connect script says. */
  connect(port: number): Promise<Duplex> {
    const answer = answerAt(this.connectScript, this.connected.length);
    this.connected.push(port);
    if (answer === 'hang') {
      return new Promise<Duplex>(() => undefined);
    }
    if (answer === 'fail') {
      return Promise.reject(new Error('connection refused'));
    }
    const connection = new FakeConnection();
    this.probes.push(connection);
    return Promise.resolve(connection);
  }

  /** A client connects to a port that is listening; undefined when nothing listens there. */
  accept(port: number): FakeConnection | undefined {
    const listener = this.listeners.get(port);
    if (listener === undefined) {
      return undefined;
    }
    const connection = new FakeConnection();
    listener(connection);
    return connection;
  }
}
