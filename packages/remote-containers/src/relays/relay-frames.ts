/**
 * @fileoverview The framing between a connection's relay host in the container and the extension: binary frames on the
 * relay host's standard streams, each a type byte, a stream number and a payload length (both 32-bit, big-endian), then
 * the payload. Frames from the container are untrusted: the reader enforces the payload cap and rejects anything it
 * doesn't know.
 */

/** The frame types: a stream opens with its kind, carries data, or closes; `ready` says every socket listens. */
type FrameType = 'open' | 'data' | 'close' | 'ready';

/** One frame. `payload` is the kind's name for `open`, the bytes for `data`, and empty for `close` and `ready`; `ready` is on stream 0. */
export interface Frame {
  type: FrameType;
  stream: number;
  payload: Uint8Array;
}

/** The type bytes on the wire. */
const TYPE_BYTES: Readonly<Record<FrameType, number>> = {
  open: 1,
  data: 2,
  close: 3,
  ready: 4,
};

/** The header's length: the type byte, the stream number and the payload length. */
const HEADER_BYTES = 9;

/** The largest payload a frame may carry, 64 KiB. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Why the reader stopped: a payload over the cap, a type it doesn't know, or a frame whose payload or stream its type doesn't allow. */
export type FrameFault = 'oversized' | 'unknownType' | 'malformed';

/** The bytes of one frame. */
export function encodeFrame(frame: Frame): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + frame.payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, TYPE_BYTES[frame.type]);
  view.setUint32(1, frame.stream);
  view.setUint32(5, frame.payload.length);
  bytes.set(frame.payload, HEADER_BYTES);
  return bytes;
}

/** The frame type of a type byte, or undefined for one this framing doesn't have. */
function typeOf(byte: number): FrameType | undefined {
  return (Object.keys(TYPE_BYTES) as FrameType[]).find(
    type => TYPE_BYTES[type] === byte,
  );
}

/**
 * Reads frames from chunks as they arrive. `push` gives the frames the chunk completed, or the fault that ends the
 * stream; after a fault every later push gives the same fault.
 */
export class FrameReader {
  private pending = new Uint8Array(0);
  private fault: FrameFault | undefined;

  /** Reads `chunk` after the bytes before it: the frames it completed, or the fault. */
  push(chunk: Uint8Array): {frames: Frame[]; fault?: FrameFault} {
    if (this.fault !== undefined) {
      return {frames: [], fault: this.fault};
    }
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    const frames: Frame[] = [];
    let offset = 0;
    while (joined.length - offset >= HEADER_BYTES) {
      const view = new DataView(joined.buffer, offset, HEADER_BYTES);
      const type = typeOf(view.getUint8(0));
      const length = view.getUint32(5);
      if (type === undefined) {
        this.fault = 'unknownType';
        return {frames, fault: this.fault};
      }
      this.fault = faultOf(type, length, view.getUint32(1));
      if (this.fault !== undefined) {
        return {frames, fault: this.fault};
      }
      if (joined.length - offset < HEADER_BYTES + length) {
        break;
      }
      const start = offset + HEADER_BYTES;
      frames.push({
        type,
        stream: view.getUint32(1),
        payload: joined.slice(start, start + length),
      });
      offset = start + length;
    }
    this.pending = joined.slice(offset);
    return {frames};
  }
}

/** The fault of a header of a known type, or undefined for one the reader takes. */
function faultOf(
  type: FrameType,
  length: number,
  stream: number,
): FrameFault | undefined {
  if (length > MAX_PAYLOAD_BYTES) {
    return 'oversized';
  }
  const empty = type === 'close' || type === 'ready';
  if ((type === 'open' && length === 0) || (empty && length > 0)) {
    return 'malformed';
  }
  return (type === 'ready') === (stream === 0) ? undefined : 'malformed';
}
