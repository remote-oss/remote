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
  let closed = 0;

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
          for (const answer of script(request)) {
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
