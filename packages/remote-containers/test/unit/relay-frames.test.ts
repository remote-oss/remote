import {deepStrictEqual} from 'node:assert';
import {
  encodeFrame,
  type Frame,
  FrameReader,
  MAX_PAYLOAD_BYTES,
} from '../../src/relays/relay-frames.ts';

const BYTES = new TextEncoder();

/** A frame's header with a raw type byte and a payload length, as an untrusted container may send it. */
function header(type: number, stream: number, length: number): Uint8Array {
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, type);
  view.setUint32(1, stream);
  view.setUint32(5, length);
  return bytes;
}

/** The fault a fresh reader gives for `bytes`. */
function faultOf(bytes: Uint8Array): string | undefined {
  return new FrameReader().push(bytes).fault;
}

describe('the relay host’s frames (card containers-179)', () => {
  it('frames go through whole, split anywhere and joined in one chunk', () => {
    const frames: Frame[] = [
      {type: 'open', stream: 1, payload: BYTES.encode('ssh-agent')},
      {type: 'data', stream: 1, payload: new Uint8Array([0, 255, 10])},
      {type: 'close', stream: 1, payload: new Uint8Array(0)},
    ];
    const wire = Uint8Array.from(
      frames.flatMap(frame => [...encodeFrame(frame)]),
    );
    const split = new FrameReader();
    const read = [
      split.push(wire.slice(0, 5)),
      split.push(wire.slice(5, 20)),
      split.push(wire.slice(20)),
    ];
    deepStrictEqual(
      [read.flatMap(each => each.frames), new FrameReader().push(wire)],
      [frames, {frames}],
    );
  });

  it('a payload over 64 KiB, an unknown type, an empty open and a close with a payload each end the reading, for good', () => {
    const oversized = new FrameReader();
    deepStrictEqual(
      [
        oversized.push(header(2, 1, MAX_PAYLOAD_BYTES + 1)).fault,
        oversized.push(
          encodeFrame({type: 'close', stream: 1, payload: new Uint8Array(0)}),
        ),
        faultOf(header(9, 1, 0)),
        faultOf(header(1, 1, 0)),
        faultOf(header(3, 1, 1)),
        new FrameReader().push(header(2, 1, MAX_PAYLOAD_BYTES)).frames,
      ],
      [
        'oversized',
        {frames: [], fault: 'oversized'},
        'unknownType',
        'malformed',
        'malformed',
        [],
      ],
    );
  });
});
