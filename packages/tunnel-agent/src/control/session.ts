/**
 * @fileoverview One control session on the tunnel's port 31545: `[cli]`'s control protocol (`tunnels/control_server.rs`,
 * `protocol.rs`) limited to what the project's client calls. The agent sends `version` first, answers `ping`, `version`,
 * `serve` with the bridge of its server connection, `servermsg`, `forward` and `unforward`, and answers every other
 * method with an error while the session goes on. A frame that isn't a message, or that is larger than the codec takes,
 * ends this session only. A server connection is read only as fast as the client takes its bytes.
 */

import type {Duplex} from 'node:stream';
import {encodeFrame, framesOf, type Frame} from './codec.ts';
import type {ServeEditorServer, ServeRequest, TunnelPorts} from './ports.ts';

/** The control protocol's version, `[cli]`'s (`constants.rs:30`). */
export const PROTOCOL_VERSION = 6;

/** The error code of a method the agent doesn't serve. */
export const METHOD_NOT_FOUND = -32601;

/** The error code of a request whose parameters the method can't take. */
export const INVALID_PARAMETERS = -32602;

/** The error code of a request the agent refuses, or that failed. */
export const REFUSED = -32000;

/** What a control session works with. */
export interface ControlPorts {
  /** The agent's own version, which the session reports. */
  version: string;
  editors: ServeEditorServer;
  tunnel: TunnelPorts;
  /** Writes one line to the agent's log; never a token, a body or a server's log line. */
  logLine: (line: string) => void;
}

/** Where a session's frames go: each sent at once, and a listener that hears when the client has taken them. */
interface Outlet {
  /** Sends `frame`; false when the client hasn't taken what was sent before. */
  send(frame: Frame): boolean;
  /** Runs `listener` once the client has taken what was sent. */
  onDrain(listener: () => void): void;
}

/** A request's answer: its result, or an error with its code. */
type Outcome =
  | {result: Readonly<Record<string, unknown>>}
  | {error: {code: number; message: string}};

/** Serves the control session on `stream` until either side ends it, then closes its server connections. */
export async function serveControl(
  stream: Duplex,
  ports: ControlPorts,
): Promise<void> {
  const connections = new Map<number, Duplex>();
  const outlet: Outlet = {
    send: frame => stream.destroyed || stream.write(encodeFrame(frame)),
    onDrain: listener => {
      stream.once('drain', listener);
    },
  };
  stream.on('error', ignoreFailure);
  outlet.send({
    method: 'version',
    params: {version: ports.version, protocol_version: PROTOCOL_VERSION},
  });
  try {
    for await (const frame of framesOf(stream)) {
      const request = requestOf(frame);
      if (request === undefined) {
        throw new Error('A frame of the control protocol is not a message.');
      }
      if (request !== 'answer') {
        void answered(request, ports, connections, outlet).then(outcome => {
          if (request.id !== undefined) {
            outlet.send({id: request.id, ...outcome});
          }
        });
      }
    }
  } catch (failure) {
    ports.logLine(`the control session ended: ${(failure as Error).message}`);
    stream.destroy();
  } finally {
    for (const connection of connections.values()) {
      connection.destroy();
    }
  }
}

/** A request or notification of the client. */
interface Request {
  id: number | undefined;
  method: string;
  params: Readonly<Record<string, unknown>>;
}

/** The request `frame` is, `'answer'` for an answer the client sends, or nothing for a frame that is neither. */
function requestOf(frame: Frame): Request | 'answer' | undefined {
  const {id: requestId, method, params} = frame;
  if (requestId !== undefined && typeof requestId !== 'number') {
    return undefined;
  }
  if (typeof method !== 'string') {
    return requestId !== undefined && ('result' in frame || 'error' in frame)
      ? 'answer'
      : undefined;
  }
  return {id: requestId, method, params: isRecord(params) ? params : {}};
}

/** What `request` is answered with, once its work is done. */
async function answered(
  request: Request,
  ports: ControlPorts,
  connections: Map<number, Duplex>,
  outlet: Outlet,
): Promise<Outcome> {
  const {method, params} = request;
  switch (method) {
    case 'ping':
      return {result: {}};
    case 'version':
      return {
        result: {version: ports.version, protocol_version: PROTOCOL_VERSION},
      };
    case 'serve':
      return served(params, ports, connections, outlet);
    case 'servermsg':
      return relayed(params, ports, connections);
    case 'forward':
      return forwarded(params, ports.tunnel);
    case 'unforward':
      return unforwarded(params, ports.tunnel);
    default:
      return failure(
        METHOD_NOT_FOUND,
        `${method} is not supported by this host`,
      );
  }
}

/** Opens the server connection a `serve` asks for and bridges it as `[cli]` does (`tunnels/server_bridge.rs`). */
async function served(
  params: Readonly<Record<string, unknown>>,
  ports: ControlPorts,
  connections: Map<number, Duplex>,
  outlet: Outlet,
): Promise<Outcome> {
  const request = serveRequestOf(params);
  if (request === undefined) {
    return failure(INVALID_PARAMETERS, 'serve needs a socket_id and a quality');
  }
  if (params.use_local_download === true) {
    return failure(REFUSED, 'use_local_download is not supported by this host');
  }
  if (params.compress === true) {
    return failure(REFUSED, 'compress is not supported by this host');
  }
  const socketId = request.socketId;
  let connection: Duplex;
  try {
    connection = await ports.editors.serve(request, (line, level) => {
      outlet.send({method: 'serverlog', params: {line, level}});
    });
  } catch (refusal) {
    return failure(REFUSED, (refusal as Error).message);
  }
  const earlier = connections.get(socketId);
  connections.set(socketId, connection);
  earlier?.destroy();
  connection.on('data', (body: Uint8Array) => {
    if (
      !outlet.send({method: 'servermsg', params: {i: socketId, body}}) &&
      !connection.isPaused()
    ) {
      connection.pause();
      outlet.onDrain(() => connection.resume());
    }
  });
  let ended = false;
  function end(): void {
    if (ended) {
      return;
    }
    ended = true;
    connection.destroy();
    if (connections.get(socketId) !== connection) {
      return;
    }
    connections.delete(socketId);
    outlet.send({method: 'serverclose', params: {i: socketId}});
  }
  connection.once('end', end);
  connection.once('close', end);
  connection.on('error', (error: Error) => {
    ports.logLine(
      `the server connection ${String(socketId)} failed: ${error.message}`,
    );
  });
  return {result: {}};
}

/** Writes the client's bytes of a `servermsg` to their server connection. */
function relayed(
  params: Readonly<Record<string, unknown>>,
  ports: ControlPorts,
  connections: ReadonlyMap<number, Duplex>,
): Outcome {
  const {i: socketId, body} = params;
  if (typeof socketId !== 'number' || !(body instanceof Uint8Array)) {
    return failure(INVALID_PARAMETERS, 'servermsg needs an i and a body');
  }
  const connection = connections.get(socketId);
  if (connection === undefined) {
    ports.logLine(
      `a message for server connection ${String(socketId)}, which is not open`,
    );
  } else {
    connection.write(body);
  }
  return {result: {}};
}

/** Adds a `forward`'s port to the tunnel as a private port; a public one is refused. */
async function forwarded(
  params: Readonly<Record<string, unknown>>,
  tunnel: TunnelPorts,
): Promise<Outcome> {
  const {port} = params;
  if (!isPort(port)) {
    return failure(INVALID_PARAMETERS, 'forward needs a port');
  }
  if (params.public === true) {
    return failure(REFUSED, 'a public port is not supported by this host');
  }
  return changed(tunnel.addPrivate(port), {uri: ''});
}

/** Removes an `unforward`'s port from the tunnel. */
async function unforwarded(
  params: Readonly<Record<string, unknown>>,
  tunnel: TunnelPorts,
): Promise<Outcome> {
  const {port} = params;
  if (!isPort(port)) {
    return failure(INVALID_PARAMETERS, 'unforward needs a port');
  }
  return changed(tunnel.remove(port), {});
}

/** `result` once `change` is done, or the error its refusal gives. */
async function changed(
  change: Promise<void>,
  result: Readonly<Record<string, unknown>>,
): Promise<Outcome> {
  try {
    await change;
    return {result};
  } catch (refusal) {
    return failure(REFUSED, (refusal as Error).message);
  }
}

/** The `serve` request `params` give, or nothing when they lack a socket id or a quality. */
function serveRequestOf(
  params: Readonly<Record<string, unknown>>,
): ServeRequest | undefined {
  const {socket_id: socketId, quality} = params;
  if (typeof socketId !== 'number' || typeof quality !== 'string') {
    return undefined;
  }
  return {
    socketId,
    commitId: stringOf(params.commit_id),
    quality,
    extensions: Array.isArray(params.extensions)
      ? params.extensions.filter(each => typeof each === 'string')
      : [],
    connectionToken: stringOf(params.connection_token),
    serverSource: isRecord(params.server_source)
      ? params.server_source
      : undefined,
  };
}

/** Takes a failure of the control stream, which the reading of its frames reports when it ends the session. */
function ignoreFailure(): void {
  // The loop over the stream's frames reports it.
}

/** An error outcome with `code` and `message`. */
function failure(code: number, message: string): Outcome {
  return {error: {code, message}};
}

/** `value` when it is a string, or nothing. */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Whether `value` is a map, not an array or bytes. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}

/** Whether `value` is a TCP port number. */
function isPort(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 65535
  );
}
