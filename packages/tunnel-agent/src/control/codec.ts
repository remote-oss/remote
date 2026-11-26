/**
 * @fileoverview The control protocol's frames: MessagePack values back to back with no length between them, each a map
 * with named fields, as `[cli]` writes them (`msgpack_rpc.rs:27-29`, `rmp_serde::to_vec_named`) and reads them
 * (`:135-160`, a value cut across reads waits for the rest).
 */

import {decodeMultiStream, encode} from '@msgpack/msgpack';

/** One frame: a request or notification `{id?, method, params}`, or an answer `{id, result | error}`. */
export type Frame = Readonly<Record<string, unknown>>;

/** The bytes of `frame`, its absent fields left out. */
export function encodeFrame(frame: Frame): Uint8Array {
  return encode(frame, {ignoreUndefined: true});
}

/**
 * The frames of `chunks`, each once all its bytes have come; throws at a value that isn't a map.
 * @yields {Frame} Each frame, in the order it came.
 */
export async function* framesOf(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<Frame> {
  for await (const value of decodeMultiStream(chunks)) {
    if (!isMap(value)) {
      throw new Error('A frame of the control protocol is not a map.');
    }
    yield value;
  }
}

/** Whether `value` is a MessagePack map with string keys. */
function isMap(value: unknown): value is Frame {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  );
}
