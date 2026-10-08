/**
 * @fileoverview An endpoint port inside one process, for tests: connections deliver JSON round-tripped messages on
 * the next microtask, so tests see the same plain data and ordering as on a socket.
 */

import type {
  EndpointConnection,
  EndpointPort,
  EndpointServer,
} from '../endpoint/protocol.ts';

class FakeConnection implements EndpointConnection {
  peer: FakeConnection | undefined;
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly closeListeners: Array<() => void> = [];
  private closed = false;

  send(message: unknown): void {
    const text = JSON.stringify(message);
    const receiver = this.peer;
    if (this.closed || receiver === undefined) {
      return;
    }
    queueMicrotask(() => {
      receiver.deliver(JSON.parse(text));
    });
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.push(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  close(): void {
    this.end();
    this.peer?.end();
  }

  private deliver(message: unknown): void {
    if (this.closed) {
      return;
    }
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private end(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener();
    }
  }
}

/** Endpoints by name, each with the listener that accepts its connections. */
export class FakeEndpointPort implements EndpointPort {
  private readonly listeners = new Map<
    string,
    (connection: EndpointConnection) => void
  >();

  /** Whether something listens on the endpoint. */
  isListening(endpoint: string): boolean {
    return this.listeners.has(endpoint);
  }

  /** Listens until the returned server closes. */
  listen(
    endpoint: string,
    onConnection: (connection: EndpointConnection) => void,
  ): Promise<EndpointServer> {
    this.listeners.set(endpoint, onConnection);
    return Promise.resolve({
      close: () => {
        this.listeners.delete(endpoint);
        return Promise.resolve();
      },
    });
  }

  /** A connected pair: the listener gets one end, the caller the other; rejects when nothing listens. */
  connect(endpoint: string): Promise<EndpointConnection> {
    const onConnection = this.listeners.get(endpoint);
    if (onConnection === undefined) {
      return Promise.reject(new Error(`nothing listens on ${endpoint}`));
    }
    const clientSide = new FakeConnection();
    const helperSide = new FakeConnection();
    clientSide.peer = helperSide;
    helperSide.peer = clientSide;
    onConnection(helperSide);
    return Promise.resolve(clientSide);
  }
}
