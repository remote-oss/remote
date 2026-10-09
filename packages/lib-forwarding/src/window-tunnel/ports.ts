/**
 * @fileoverview What the window tunnel and the tunnel factory need from their surroundings: a connection that
 * carries bytes, a dialer that opens one to the server's side, and the machine's own loopback ports. The library
 * opens no socket itself; the adapters implement these over `net` and over the SSH connection.
 */

/**
 * A connection that carries bytes in both directions and tells when it ends. It delivers bytes only to listeners
 * already attached: an adapter holds earlier bytes until the first data listener is attached, so none is lost.
 */
export interface Duplex {
  send(chunk: Uint8Array): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

/** Where on the host a tunnel ends: a TCP port on its IPv4 loopback, or a Unix socket path. */
export type TunnelTarget =
  {kind: 'port'; port: number} | {kind: 'socket'; path: string};

/** Opens a connection to a target on the host, through the SSH connection. */
export interface Dialer {
  dial(target: TunnelTarget): Promise<Duplex>;
}

/** A listening port on this machine's loopback, closed when the tunnel ends. */
export interface Listening {
  close(): void;
}

/** This machine's loopback: listen on a port, or connect to one. */
export interface LocalPort {
  listen(
    port: number,
    onConnection: (connection: Duplex) => void,
  ): Promise<Listening>;
  connect(port: number): Promise<Duplex>;
}
