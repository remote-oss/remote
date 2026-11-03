/**
 * @fileoverview A fake command-line program for tests of the control client: the client's end of an in-memory stream
 * pair, and the program's end, which decodes the client's requests, records them and answers from a script.
 */

import {decodeMulti, encode} from '@msgpack/msgpack';
import {type CliControl, openCliControl} from '../cli-control/client.ts';
import type {ByteStream} from '../cli-control/control-types.ts';

/** One message of the client, as the program read it. */
export type Request = Readonly<Record<string, unknown>>;

/** Answers a request with the messages the program sends back, in order; none by default. */
export type CliScript = (request: Request) => readonly unknown[];

/** The program's end of the stream. */
export interface FakeCli {
  /** The end the client is given. */
  readonly stream: ByteStream;
  /** Every message the client sent, in order. */
  readonly requests: Request[];
  /** The socket ids of every `servermsg` the client sent for a socket no `serve` had attached, as the program rejects them. */
  readonly rejected: number[];
  /** How often the client closed its end. */
  closes(): number;
  /** Sends bytes to the client as one chunk. */
  deliver(chunk: Uint8Array): void;
  /** Sends each message to the client as a chunk of its own. */
  send(...messages: unknown[]): void;
  /** Ends the stream from the program's side. */
  end(): void;
}

/** A fake command-line program that answers the client's requests from `script`. */
export function fakeCli(script: CliScript): FakeCli {
  const requests: Request[] = [];
  const dataListeners: Array<(chunk: Uint8Array) => void> = [];
  const closeListeners: Array<() => void> = [];
  const served = new Set<number>();
  const rejected: number[] = [];
  let closed = 0;

  /** Notes a `servermsg` for a socket no `serve` has attached yet, which the program rejects. */
  function noteServermsg(request: Request): void {
    const {i: socketId} = request.params as {i?: number};
    if (
      request.method === 'servermsg' &&
      socketId !== undefined &&
      !served.has(socketId)
    ) {
      rejected.push(socketId);
    }
  }

  /** Attaches the socket of a `serve` that the script answered with a result. */
  function noteServe(request: Request, answers: readonly unknown[]): void {
    const {socket_id: socketId} = request.params as {socket_id?: number};
    if (
      request.method === 'serve' &&
      socketId !== undefined &&
      answers.some(
        answer =>
          (answer as {id?: unknown; result?: unknown}).id === request.id &&
          'result' in (answer as object),
      )
    ) {
      served.add(socketId);
    }
  }

  function deliver(chunk: Uint8Array): void {
    for (const listener of dataListeners) {
      listener(chunk);
    }
  }

  function end(): void {
    for (const listener of closeListeners) {
      listener();
    }
  }

  return {
    stream: {
      send: chunk => {
        for (const message of decodeMulti(chunk)) {
          const request = message as Request;
          requests.push(request);
          noteServermsg(request);
          const answers = script(request);
          noteServe(request, answers);
          for (const answer of answers) {
            deliver(encode(answer));
          }
        }
        return true;
      },
      onData: listener => {
        dataListeners.push(listener);
      },
      onClose: listener => {
        closeListeners.push(listener);
      },
      close: () => {
        closed += 1;
      },
    },
    requests,
    rejected,
    closes: () => closed,
    deliver,
    send: (...messages) => {
      for (const message of messages) {
        deliver(encode(message));
      }
    },
    end,
  };
}

/** The `streams_started` notification that gives the request `requestId` the streams `streamIds`, before its reply. */
export function streamsStarted(
  requestId: number,
  streamIds: readonly number[],
): unknown {
  return {
    id: null,
    method: 'streams_started',
    params: {for_request_id: requestId, stream_ids: [...streamIds]},
  };
}

/** The `stream_data` notification that sends `segment` to the client on stream `stream`. */
export function streamData(stream: number, segment: Uint8Array): unknown {
  return {id: null, method: 'stream_data', params: {segment, stream}};
}

/** The `stream_ended` notification that ends the CLI's side of stream `stream`. */
export function streamEnded(stream: number): unknown {
  return {id: null, method: 'stream_ended', params: {stream}};
}

/** What a fake CLI sends back for a request. */
export type Answer = (request: Request) => readonly unknown[];

/** The id of a request. */
export function idOf(request: Request): number {
  return request.id as number;
}

/** An answer that is a result. */
export function replying(result: unknown): Answer {
  return request => [{id: request.id, result}];
}

/** An answer that is an error. */
export function failing(message: string): Answer {
  return request => [{id: request.id, error: {code: -1, message}}];
}

/** An answer that announces `streamIds` and then replies with `result`. */
export function streaming(streamIds: number[], result: unknown): Answer {
  return request => [
    streamsStarted(idOf(request), streamIds),
    {id: request.id, result},
  ];
}

/** An answer that announces `streamIds` and leaves the reply for later. */
export function announcing(streamIds: number[]): Answer {
  return request => [streamsStarted(idOf(request), streamIds)];
}

/** The control connection over a fake CLI that answers each method as `answers` says, and nothing else. */
export function connectedTo(answers: Record<string, Answer>): {
  peer: FakeCli;
  control: CliControl;
} {
  const peer = fakeCli(
    request => answers[String(request.method)]?.(request) ?? [],
  );
  return {peer, control: openCliControl(peer.stream)};
}

/** Lets the messages already delivered be read. */
export function settle(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

/** The parameters of a `spawn` request as the CLI reads them, with `extras` beside the command and its arguments. */
export function spawnWire(
  command: string,
  argumentList: readonly string[],
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  // eslint-disable-next-line id-denylist -- the CLI's name for the parameter
  return {command, args: [...argumentList], ...extras};
}
