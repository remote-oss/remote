/**
 * @fileoverview The client of the editor command-line program's control connection: the challenge, `serve` with its
 * `serverlog` stream, and one `servermsg` socket per editor connection. It owns no socket; it speaks over the byte
 * stream it is given.
 */

import {createHash} from 'node:crypto';
import {encode} from '@msgpack/msgpack';
import {parseCliServeError} from '../cli-path/cli-output.ts';
import type {ByteStream, CliControlFailure} from './control-types.ts';
import {
  methodsOf,
  type CliMethods,
  type StreamedCall,
} from './control-methods.ts';
import {
  classify,
  isMap,
  messageReader,
  type Reply,
  streamDataMessage,
  streamDataOf,
  streamEndedMessage,
  streamEndedOf,
  streamsStartedOf,
} from './rpc.ts';

export type {ByteStream, CliControlFailure} from './control-types.ts';

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
export interface CliControl extends CliMethods {
  /** Runs the challenge with the token. */
  authenticate(
    token: string,
  ): Promise<{kind: 'authenticated'} | CliControlFailure>;
  /**
   * Runs the connect's `serve` on socket 0, which the client keeps for the first editor connection; `onLog` gets each
   * `serverlog` line as it arrives, before the reply. It is called once per connection.
   */
  serve(
    params: CliServeParams,
    onLog: (line: ServerLogLine) => void,
  ): Promise<{kind: 'serving'; socket: CliSocket} | CliControlFailure>;
  /**
   * Runs `serve` again, with the next socket id and the first `serve`'s parameters, and opens that socket. The
   * command-line program attaches one bridge per `serve` socket, so every editor connection needs its own; the later
   * ones find the server running and only attach. Only one `serve` runs at a time; calls wait in order.
   */
  openSocket(
    onLog: (line: ServerLogLine) => void,
  ): Promise<{kind: 'serving'; socket: CliSocket} | CliControlFailure>;
  close(): void;
}

/** The level of a `serverlog` line that reports an error. */
const ERROR_LEVEL = 4;

/** The response to a challenge: base64url, without padding, of the SHA-256 of its text. */
function responseTo(challenge: string): string {
  return createHash('sha256').update(challenge, 'utf8').digest('base64url');
}

/** The state of one duplex stream a method opened. */
interface StreamState {
  dataListeners: Array<(chunk: Uint8Array) => void>;
  closeListeners: Array<() => void>;
  /** What arrived before the first listener, handed to it when it comes. */
  backlog: Uint8Array[];
  closed: boolean;
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
  const sockets = new Map<number, SocketState>();
  const streams = new Map<number, StreamState>();
  const starts = new Map<number, (streamIds: number[]) => void>();
  let nextId = 1;
  let ended = false;
  let streamClosed = false;
  let logListener: ((line: ServerLogLine) => void) | undefined;
  let errorLine: string | undefined;
  let firstParams: CliServeParams | undefined;
  let succeeded = false;
  let nextSocketId = 0;
  let running: Promise<unknown> = Promise.resolve();

  function finish(): void {
    if (ended) {
      return;
    }
    ended = true;
    for (const settle of pending.values()) {
      settle(undefined);
    }
    pending.clear();
    starts.clear();
    for (const socket of sockets.values()) {
      closeSocket(socket);
    }
    for (const state of streams.values()) {
      closeStream(state);
    }
  }

  function closeStream(state: StreamState): void {
    if (state.closed) {
      return;
    }
    state.closed = true;
    for (const listener of state.closeListeners) {
      listener();
    }
  }

  /** Tells the listeners of the stream `params` names about its bytes, or keeps them for the first listener. */
  function handleStreamData(params: Readonly<Record<string, unknown>>): void {
    const data = streamDataOf(params);
    const state = data === undefined ? undefined : streams.get(data.stream);
    if (data === undefined || state === undefined || state.closed) {
      return;
    }
    if (state.dataListeners.length === 0) {
      state.backlog.push(data.segment);
    }
    for (const listener of state.dataListeners) {
      listener(data.segment);
    }
  }

  /** Hands the streams of a duplex request to the call that waits for them. */
  function handleStreamsStarted(
    params: Readonly<Record<string, unknown>>,
  ): void {
    const started = streamsStartedOf(params);
    if (started !== undefined) {
      starts.get(started.requestId)?.(started.streamIds);
      starts.delete(started.requestId);
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
    const socket =
      typeof params.i === 'number' ? sockets.get(params.i) : undefined;
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
    } else if (method === 'streams_started') {
      handleStreamsStarted(params);
    } else if (method === 'stream_data') {
      handleStreamData(params);
    } else if (method === 'stream_ended') {
      const ended = streamEndedOf(params);
      const state = ended === undefined ? undefined : streams.get(ended);
      if (state !== undefined) {
        closeStream(state);
      }
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

  /** The stream `streamId` as the caller holds it. */
  function byteStreamOf(streamId: number, state: StreamState): ByteStream {
    return {
      send: chunk => {
        if (ended || state.closed) {
          return false;
        }
        return stream.send(streamDataMessage(streamId, chunk));
      },
      onData: listener => {
        state.dataListeners.push(listener);
        for (const chunk of state.backlog.splice(0)) {
          listener(chunk);
        }
      },
      onClose: listener => {
        if (state.closed) {
          listener();
        } else {
          state.closeListeners.push(listener);
        }
      },
      close: () => {
        if (!ended && !state.closed) {
          stream.send(streamEndedMessage(streamId));
        }
        closeStream(state);
      },
    };
  }

  /**
   * Sends a request whose reply follows `streamCount` duplex streams. The CLI announces the stream ids before it runs
   * the method, and replies when the method has finished; an error before the announcement comes as the reply alone.
   */
  function requestStreamed(
    method: string,
    params: Record<string, unknown>,
    streamCount: number,
  ): Promise<StreamedCall> {
    if (ended) {
      return Promise.resolve({kind: 'replied', reply: undefined});
    }
    const requestId = nextId;
    nextId += 1;
    const reply = new Promise<Reply | undefined>(resolve => {
      pending.set(requestId, resolve);
    });
    const announced = new Promise<StreamedCall>(resolve => {
      starts.set(requestId, streamIds => {
        if (streamIds.length !== streamCount) {
          resolve({kind: 'malformed'});
          return;
        }
        const opened = streamIds.map(streamId => {
          const state: StreamState = {
            dataListeners: [],
            closeListeners: [],
            backlog: [],
            closed: false,
          };
          streams.set(streamId, state);
          return byteStreamOf(streamId, state);
        });
        resolve({kind: 'started', streams: opened, reply});
      });
    });
    stream.send(encode({id: requestId, method, params}));
    return Promise.race([
      announced,
      reply.then((settled): StreamedCall => ({
        kind: 'replied',
        reply: settled,
      })),
    ]);
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

  /** The socket `state` as the caller holds it. */
  function socketOf(socketId: number, state: SocketState): CliSocket {
    return {
      socketId,
      send: chunk => {
        if (!ended && !state.closed) {
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
  }

  /** Sends `serve` for `socketId` and tells how it went; the socket is kept only when the reply is a result. */
  async function serveSocket(
    socketId: number,
    params: CliServeParams,
    onLog: (line: ServerLogLine) => void,
  ): Promise<{kind: 'serving'; socket: CliSocket} | CliControlFailure> {
    logListener = onLog;
    errorLine = undefined;
    const state: SocketState = {
      dataListeners: [],
      closeListeners: [],
      closed: false,
    };
    sockets.set(socketId, state);
    const reply = await request('serve', {
      socket_id: socketId,
      commit_id: params.commit,
      quality: params.quality,
      extensions: [],
      connection_token: params.connectionToken,
      use_local_download: params.useLocalDownload,
      compress: false,
    });
    logListener = undefined;
    if (reply?.kind === 'result') {
      return {kind: 'serving', socket: socketOf(socketId, state)};
    }
    return reply === undefined
      ? {kind: 'closed'}
      : {
          kind: 'serveFailed',
          error: parseCliServeError(reply.message),
          message: reply.message,
          errorLine,
        };
  }

  /** Runs `work` after every earlier one has finished: `serverlog` lines name no socket, so two must not overlap. */
  function oneAtATime<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = running.then(work);
    running = result.catch(() => undefined);
    return result;
  }

  return {
    ...methodsOf({request, requestStreamed}),
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
    serve: (params, onLog) => {
      if (firstParams !== undefined) {
        throw new Error('serve was already called');
      }
      firstParams = params;
      nextSocketId = 1;
      return oneAtATime(async () => {
        const outcome = await serveSocket(0, params, onLog);
        succeeded = outcome.kind === 'serving';
        return outcome;
      });
    },
    openSocket: onLog => {
      if (!succeeded || firstParams === undefined) {
        throw new Error('serve has not succeeded');
      }
      const params = firstParams;
      const socketId = nextSocketId;
      nextSocketId += 1;
      return oneAtATime(() => serveSocket(socketId, params, onLog));
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
