/**
 * @fileoverview The types that the control client and its methods share: the byte stream under a connection or a duplex
 * stream, and the reasons a call does not go through.
 */

import type {CliServeError} from '../cli-path/cli-output.ts';

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
  | {kind: 'closed'}
  /** The CLI answered a method with an error. */
  | {kind: 'callFailed'; method: string; message: string}
  /** The CLI's result for a method is not the shape the method returns. */
  | {kind: 'malformedReply'; method: string};
