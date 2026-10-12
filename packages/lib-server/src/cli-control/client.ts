/**
 * @fileoverview The client of the editor command-line program's control connection: the challenge, `serve` with its
 * `serverlog` stream, and one `servermsg` socket per editor connection. It owns no socket; it speaks over the byte
 * stream it is given.
 */

import {createHash} from 'node:crypto';
import {encode} from '@msgpack/msgpack';
import {
  type CliServeError,
  parseCliServeError,
} from '../cli-path/cli-output.ts';
import {classify, isMap, messageReader, type Reply} from './rpc.ts';

/** A connection that carries bytes both ways. */
export interface ByteStream {
  send(chunk: Uint8Array): boolean;
  onData(listener: (chunk: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

/** Why a step of the control connection did not go through. */
export type CliControlFailure =
  | {kind: 'challengeRefused'; message: string}
  | {
      kind: 'serveFailed';
      error: CliServeError;
      message: string;
      errorLine: string | undefined;
    }
  | {kind: 'closed'};

/** One `serverlog` line. */
export interface ServerLogLine {
  text: string;
  level: number;
}

/** The parameters of `serve` the caller chooses. */
export interface CliServeParams {
  commit: string;
  quality: string;
  connectionToken: string;
  useLocalDownload: boolean;
}

/** One server socket of the connection, for one editor connection. */
export interface CliSocket {
  readonly socketId: number;
  /** Sends the bytes to the server as one `servermsg`. */
  send(chunk: Uint8Array): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  /** The server closed the socket, or the control connection ended. */
  onClose(listener: () => void): void;
}

/** The control connection to the command-line program. */
export interface CliControl {
  /** Runs the challenge with the token. */
  authenticate(
    token: string,
  ): Promise<{kind: 'authenticated'} | CliControlFailure>;
  /** Runs `serve`; `onLog` gets each `serverlog` line as it arrives, before the reply. */
  serve(
    params: CliServeParams,
    onLog: (line: ServerLogLine) => void,
  ): Promise<{kind: 'serving'} | CliControlFailure>;
  /** Opens the next server socket, numbered from 0. */
  openSocket(): CliSocket;
  close(): void;
}

/** The level of a `serverlog` line that reports an error. */
const ERROR_LEVEL = 4;

/** The response to a challenge: base64url, without padding, of the SHA-256 of its text. */
function responseTo(challenge: string): string {
  return createHash('sha256').update(challenge, 'utf8').digest('base64url');
}

/** The state of one socket on the connection. */
interface SocketState {
  dataListeners: Array<(chunk: Uint8Array) => void>;
  closeListeners: Array<() => void>;
  closed: boolean;
}

/** Opens the control connection over `stream`. */
export function openCliControl(stream: ByteStream): CliControl {
  const pending = new Map<number, (reply: Reply | undefined) => void>();
  const sockets: SocketState[] = [];
  let nextId = 1;
  let ended = false;
  let streamClosed = false;
  let logListener: ((line: ServerLogLine) => void) | undefined;
  let errorLine: string | undefined;

  function finish(): void {
    if (ended) {
      return;
    }
    ended = true;
    for (const settle of pending.values()) {
      settle(undefined);
    }
    pending.clear();
    for (const socket of sockets) {
      closeSocket(socket);
    }
  }

  function closeSocket(socket: SocketState): void {
    if (socket.closed) {
      return;
    }
    socket.closed = true;
    for (const listener of socket.closeListeners) {
      listener();
    }
  }

  function handleNotification(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): void {
    const socket = typeof params.i === 'number' ? sockets[params.i] : undefined;
    if (method === 'serverlog' && typeof params.line === 'string') {
      const line = {text: params.line, level: Number(params.level)};
      if (line.level === ERROR_LEVEL) {
        errorLine = line.text;
      }
      logListener?.(line);
    } else if (
      method === 'servermsg' &&
      socket !== undefined &&
      params.body instanceof Uint8Array
    ) {
      for (const listener of socket.dataListeners) {
        listener(params.body);
      }
    } else if (method === 'serverclose' && socket !== undefined) {
      closeSocket(socket);
    }
  }

  const reader = messageReader(message => {
    const incoming = classify(message);
    if (incoming.kind === 'reply') {
      pending.get(incoming.id)?.(incoming.reply);
      pending.delete(incoming.id);
    } else if (incoming.kind === 'notification') {
      handleNotification(incoming.method, incoming.params);
    }
  }, finish);
  stream.onData(chunk => {
    reader.push(chunk);
  });
  stream.onClose(() => {
    streamClosed = true;
    reader.end();
  });

  /** Sends a request and gives its reply, or nothing when the connection ended first. */
  function request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Reply | undefined> {
    if (ended) {
      return Promise.resolve(undefined);
    }
    const requestId = nextId;
    nextId += 1;
    return new Promise(resolve => {
      pending.set(requestId, resolve);
      stream.send(encode({id: requestId, method, params}));
    });
  }

  /** One step of the challenge: its result map, or the failure. */
  async function challengeStep(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown> | CliControlFailure> {
    const reply = await request(method, params);
    if (reply === undefined) {
      return {kind: 'closed'};
    }
    if (reply.kind === 'error') {
      return {kind: 'challengeRefused', message: reply.message};
    }
    return isMap(reply.result) ? {...reply.result} : {};
  }

  return {
    authenticate: async token => {
      const issued = await challengeStep('challenge_issue', {token});
      if ('kind' in issued) {
        return issued as CliControlFailure;
      }
      if (typeof issued.challenge !== 'string') {
        return {
          kind: 'challengeRefused',
          message: 'the challenge was not issued',
        };
      }
      const verified = await challengeStep('challenge_verify', {
        response: responseTo(issued.challenge),
      });
      return 'kind' in verified
        ? (verified as CliControlFailure)
        : {kind: 'authenticated'};
    },
    serve: async (params, onLog) => {
      logListener = onLog;
      errorLine = undefined;
      const reply = await request('serve', {
        socket_id: 0,
        commit_id: params.commit,
        quality: params.quality,
        extensions: [],
        connection_token: params.connectionToken,
        use_local_download: params.useLocalDownload,
        compress: false,
      });
      logListener = undefined;
      if (reply === undefined) {
        return {kind: 'closed'};
      }
      if (reply.kind === 'error') {
        return {
          kind: 'serveFailed',
          error: parseCliServeError(reply.message),
          message: reply.message,
          errorLine,
        };
      }
      return {kind: 'serving'};
    },
    openSocket: () => {
      const socketId = sockets.length;
      const state: SocketState = {
        dataListeners: [],
        closeListeners: [],
        closed: ended,
      };
      sockets.push(state);
      return {
        socketId,
        send: chunk => {
          if (!ended) {
            stream.send(
              encode({method: 'servermsg', params: {i: socketId, body: chunk}}),
            );
          }
        },
        onData: listener => {
          state.dataListeners.push(listener);
        },
        onClose: listener => {
          if (state.closed) {
            listener();
          } else {
            state.closeListeners.push(listener);
          }
        },
      };
    },
    close: () => {
      if (!streamClosed) {
        streamClosed = true;
        stream.close();
      }
      reader.end();
      finish();
    },
  };
}
