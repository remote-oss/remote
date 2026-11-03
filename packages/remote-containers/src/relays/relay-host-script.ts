/**
 * @fileoverview The relay host: a Node program of ours that runs in the container, for one connection, with the
 * installed server's own `node`. It listens on the Unix sockets its arguments name (`<kind>=<path>`), each mode 0600,
 * and carries every connection to them as a numbered stream of frames on its standard streams. It ends when its
 * standard input does.
 */

import type {HostChannel} from 'lib-host';
import {
  dataScriptPath,
  installDataScript,
  type RelayInstall,
} from '../exec/relay-script.ts';

/** The script, in CommonJS for the server's `node`; its frames are those of `relay-frames.ts`. */
export const RELAY_HOST_SCRIPT = `'use strict';
const net = require('net');
const fs = require('fs');
const HEADER = 9;
const MAX_PAYLOAD = 65536;
const sockets = new Map();
let next = 1;
function frame(type, stream, payload) {
  const bytes = Buffer.alloc(HEADER + payload.length);
  bytes[0] = type;
  bytes.writeUInt32BE(stream, 1);
  bytes.writeUInt32BE(payload.length, 5);
  payload.copy(bytes, HEADER);
  return bytes;
}
function send(bytes) {
  if (!process.stdout.write(bytes)) {
    for (const socket of sockets.values()) socket.pause();
    process.stdout.once('drain', () => {
      for (const socket of sockets.values()) socket.resume();
    });
  }
}
function serve(kind, socketPath) {
  try { fs.unlinkSync(socketPath); } catch (error) {}
  const server = net.createServer(socket => {
    const stream = next++;
    sockets.set(stream, socket);
    send(frame(1, stream, Buffer.from(kind)));
    socket.on('data', data => {
      for (let start = 0; start < data.length; start += MAX_PAYLOAD) {
        send(frame(2, stream, data.subarray(start, start + MAX_PAYLOAD)));
      }
    });
    socket.on('close', () => {
      if (sockets.delete(stream)) send(frame(3, stream, Buffer.alloc(0)));
    });
    socket.on('error', () => {});
  });
  const previous = process.umask(0o177);
  server.listen(socketPath, () => process.umask(previous));
}
for (const pair of process.argv.slice(2)) {
  const separator = pair.indexOf('=');
  serve(pair.slice(0, separator), pair.slice(separator + 1));
}
let pending = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= HEADER) {
    const length = pending.readUInt32BE(5);
    if (pending.length < HEADER + length) break;
    const type = pending[0];
    const stream = pending.readUInt32BE(1);
    const socket = sockets.get(stream);
    const payload = pending.subarray(HEADER, HEADER + length);
    pending = pending.subarray(HEADER + length);
    if (socket === undefined) continue;
    if (type === 2 && !socket.write(payload)) {
      process.stdin.pause();
      socket.once('drain', () => process.stdin.resume());
    } else if (type === 3) {
      sockets.delete(stream);
      socket.end();
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`;

/** Where the relay host goes in the server's data folder. */
export function relayHostScriptPath(dataFolder: string): string {
  return dataScriptPath(dataFolder, 'relay-host', RELAY_HOST_SCRIPT);
}

/** Writes the relay host into the data folder as the channel's user, mode 0644. */
export function installRelayHostScript(
  channel: HostChannel,
  dataFolder: string,
  cancellation: AbortSignal,
): Promise<RelayInstall> {
  return installDataScript(
    channel,
    dataFolder,
    {name: 'relay-host', text: RELAY_HOST_SCRIPT},
    cancellation,
  );
}
