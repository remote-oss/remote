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
  readonly sent: Uint8Array[] = [];
  closed = false;
  private readonly dataListeners: Array<(chunk: Uint8Array) => void> = [];
  private readonly closeListeners: Array<() => void> = [];

  send(chunk: Uint8Array): void {
    this.sent.push(chunk);
  }

  onData(listener: (chunk: Uint8Array) => void): void {
    this.dataListeners.push(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

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
  readonly dialed: TunnelTarget[] = [];
  readonly connections: FakeConnection[] = [];
  private readonly script: readonly Answer[];

  constructor(script: readonly Answer[] = ['work']) {
    this.script = script;
  }

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
  readonly listened: number[] = [];
  readonly connected: number[] = [];
  readonly probes: FakeConnection[] = [];
  readonly closedPorts: number[] = [];
  private readonly listeners = new Map<number, (connection: Duplex) => void>();
  private readonly listenAnswer: Answer;
  private readonly connectScript: readonly Answer[];

  constructor(
    listenAnswer: Answer = 'work',
    connectScript: readonly Answer[] = ['work'],
  ) {
    this.listenAnswer = listenAnswer;
    this.connectScript = connectScript;
  }

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
