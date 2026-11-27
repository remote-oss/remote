/**
 * @fileoverview What the control protocol asks of the rest of the agent: the editor server a client's `serve` connects
 * to, and the tunnel's ports a client's `forward` changes.
 */

import type {Duplex} from 'node:stream';

/** What a client's `serve` asks for. */
export interface ServeRequest {
  /** The client's number for this connection, which every message of it carries. */
  socketId: number;
  commitId: string | undefined;
  quality: string;
  extensions: string[];
  connectionToken: string | undefined;
  /** Where the client's editor gets its server, as the client sends it. */
  serverSource: Readonly<Record<string, unknown>> | undefined;
}

/** Starts or joins editor servers. */
export interface ServeEditorServer {
  /**
   * Starts or joins the server `request` names, once it's ready, and opens one connection to it. `onLogLine` hears
   * the server's log lines with their levels.
   */
  serve(
    request: ServeRequest,
    onLogLine: (line: string, level: number) => void,
  ): Promise<Duplex>;
}

/** The ports of the agent's tunnel. */
export interface TunnelPorts {
  /** Adds `port` to the tunnel as a private port; rejects with the relay's reason when it refuses. */
  addPrivate(port: number): Promise<void>;
  /** Removes `port` from the tunnel. */
  remove(port: number): Promise<void>;
}
