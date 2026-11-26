/**
 * @fileoverview The copy each buffer gets before the relay hands it to `ws`. dev-tunnels-ssh's `WebSocketStream` reuses
 * the buffer it passes `send` for its next packet, as a browser WebSocket copies on send; `ws` keeps a reference while
 * the socket is busy, so without a copy a queued packet would be overwritten.
 */

import type {WebSocket} from 'ws';

/** Makes `websocket` send a copy of each buffer it is given. */
export function sendCopies(websocket: WebSocket): void {
  const send = websocket.send.bind(websocket);
  websocket.send = ((data: ArrayBuffer | Buffer, ...rest: never[]) => {
    send(
      Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data),
      ...rest,
    );
  }) as typeof websocket.send;
}
