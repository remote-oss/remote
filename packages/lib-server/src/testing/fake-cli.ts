/**
 * @fileoverview A fake command-line program for tests of the control client: the client's end of an in-memory stream
 * pair, and the program's end, which decodes the client's requests, records them and answers from a script.
 */

import {decodeMulti, encode} from '@msgpack/msgpack';
import type {ByteStream} from '../cli-control/client.ts';

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
