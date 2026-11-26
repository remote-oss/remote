/**
 * @fileoverview The control protocol's frames: MessagePack values back to back with no length between them, each a map
 * with named fields, as `[cli]` writes them (`msgpack_rpc.rs:27-29`, `rmp_serde::to_vec_named`) and reads them
 * (`:135-160`, a value cut across reads waits for the rest). A frame larger than the codec takes ends the reading: its
 * bytes, its strings, its bodies and its lists are each bounded.
 */

import {decodeMultiStream, encode, type DecoderOptions} from '@msgpack/msgpack';

/** One frame: a request or notification `{id?, method, params}`, or an answer `{id, result | error}`. */
export type Frame = Readonly<Record<string, unknown>>;

/** The most bytes the codec holds for one frame before it has all of it. */
export const LARGEST_FRAME = 2 * 1024 * 1024;

/** The largest body a frame carries, which a `servermsg` is: one read of a socket, well under this. */
export const LARGEST_BODY = 1024 * 1024;

/** The bounds of each kind of value in a frame. */
const VALUE_LIMITS: DecoderOptions = {
  maxStrLength: 64 * 1024,
  maxBinLength: LARGEST_BODY,
  maxArrayLength: 4096,
  maxMapLength: 64,
  maxExtLength: 0,
};

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
  let held = 0;
  async function* bounded(): AsyncGenerator<Uint8Array> {
    for await (const chunk of chunks) {
      held += chunk.length;
      if (held > LARGEST_FRAME) {
        throw new Error(
          `A frame of the control protocol is larger than ${String(LARGEST_FRAME)} bytes.`,
        );
      }
      yield chunk;
    }
  }
  for await (const value of decodeMultiStream<undefined>(
    bounded(),
    VALUE_LIMITS,
  )) {
    held = 0;
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
