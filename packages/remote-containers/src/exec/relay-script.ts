/**
 * @fileoverview The relay script: a small Node program that runs in the container with the installed server's own
 * `node` and carries the bytes of one `docker exec` to a port on the container's loopback. It is the only code of ours
 * that runs in the container besides the install and start scripts.
 */

import {createHash} from 'node:crypto';
import {type HostChannel, posixQuote} from 'lib-host';

/** The script, in CommonJS for the server's `node`: stdin to the socket, the socket to stdout, and its end ends it. */
export const RELAY_SCRIPT = `'use strict';
const net = require('net');
const port = Number(process.argv[2]);
const socket = net.connect({host: '127.0.0.1', port});
socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));
process.stdin.on('end', () => socket.end());
process.stdin.pipe(socket);
socket.pipe(process.stdout);
`;

/** Where the script goes: in the server's data folder, under a name that follows its text. */
export function relayScriptPath(dataFolder: string): string {
  const digest = createHash('sha256').update(RELAY_SCRIPT).digest('hex');
  return `${dataFolder}/relay-${digest.slice(0, 12)}.js`;
}

/** How installing the script ended. */
export type RelayInstall =
  {kind: 'written'; path: string} | {kind: 'failed'; detail: string};

/** Writes the script into the data folder as the channel's user, mode 0644, so a changed script never meets an old one. */
export async function installRelayScript(
  channel: HostChannel,
  dataFolder: string,
  cancellation: AbortSignal,
): Promise<RelayInstall> {
  const target = relayScriptPath(dataFolder);
  const part = posixQuote(`${target}.part`);
  const outcome = await channel.runScript(
    {
      script: [
        'set -e',
        'umask 022',
        `mkdir -p ${posixQuote(dataFolder)}`,
        `cat > ${part}`,
        `chmod 0644 ${part}`,
        `mv -f ${part} ${posixQuote(target)}`,
      ].join('\n'),
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: RELAY_SCRIPT},
      cancellation,
    },
    () => undefined,
  );
  if (outcome.kind === 'failed') {
    return {kind: 'failed', detail: outcome.failure.detail};
  }
  return outcome.status === 0
    ? {kind: 'written', path: target}
    : {
        kind: 'failed',
        detail: `relay script not written (exit ${String(outcome.status)})`,
      };
}
