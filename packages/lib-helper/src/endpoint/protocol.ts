/**
 * @fileoverview The endpoint between a helper and its clients, as a port (a Unix socket in the product, an
 * in-process pair in tests), and the messages it carries: one JSON object per line.
 */

/** A value that survives JSON unchanged. */
export type PlainData =
  string | number | boolean | null | PlainData[] | {[name: string]: PlainData};

/** What a client sends: the hello that opens its lease, a request, or the order to end the helper. */
export type ClientMessage =
  | {type: 'hello'; nonce: string}
  | {type: 'request'; requestId: number; body: PlainData}
  | {type: 'stop'};

/** What a helper sends: the lease it granted, a reply, the live leases after a change, or its own message. */
export type HelperMessage =
  | {
      type: 'welcome';
      lease: number;
      leases: number[];
      payload: Record<string, string | number | boolean>;
    }
  | {type: 'reply'; requestId: number; body: PlainData}
  | {type: 'failed'; requestId: number; reason: string}
  | {type: 'leaseListChanged'; leases: number[]}
  | {type: 'message'; body: PlainData};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The client message `value` is, or undefined when it is none. */
export function readClientMessage(value: unknown): ClientMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type === 'hello' && typeof value.nonce === 'string') {
    return {type: 'hello', nonce: value.nonce};
  }
  if (
    value.type === 'request' &&
    typeof value.requestId === 'number' &&
    'body' in value
  ) {
    // The endpoint delivers parsed JSON, so the body is plain data.
    return {
      type: 'request',
      requestId: value.requestId,
      body: value.body as PlainData,
    };
  }
  return value.type === 'stop' ? {type: 'stop'} : undefined;
}

/** One open connection; messages are JSON values, delivered in order. */
export interface EndpointConnection {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  /** Called once, when either side closes or the connection breaks. */
  onClose(listener: () => void): void;
  close(): void;
}

/** A listening endpoint. */
export interface EndpointServer {
  /** Stops accepting connections and removes the endpoint. */
  close(): Promise<void>;
}

/** Listening and connecting by endpoint name. */
export interface EndpointPort {
  listen(
    endpoint: string,
    onConnection: (connection: EndpointConnection) => void,
  ): Promise<EndpointServer>;
  /** Rejects when nothing listens on the endpoint. */
  connect(endpoint: string): Promise<EndpointConnection>;
}
