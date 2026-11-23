/**
 * @fileoverview The relay script: a small Node program that runs in the container with the installed server's own
 * `node` and carries the bytes of one `docker exec` to a port on the container's loopback. It is the only code of ours
 * that runs in the container besides the install and start scripts.
 */

import {createHash} from 'node:crypto';
import {type HostChannel, posixQuote} from 'lib-host';
import {writeHostFile} from './host-file.ts';

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

/** Where a script of ours named `name` goes: in the server's data folder, under a name that follows its text. */
export function dataScriptPath(
  dataFolder: string,
  name: string,
  text: string,
): string {
  const digest = createHash('sha256').update(text).digest('hex');
  return `${dataFolder}/${name}-${digest.slice(0, 12)}.js`;
}

/** Where the relay script goes. */
export function relayScriptPath(dataFolder: string): string {
  return dataScriptPath(dataFolder, 'relay', RELAY_SCRIPT);
}

/** How installing a script ended. */
export type RelayInstall =
  {kind: 'written'; path: string} | {kind: 'failed'; detail: string};

/**
 * Writes the script `text` named `name` into the data folder as the channel's user, mode 0644, so a changed script
 * never meets an old one.
 */
export async function installDataScript(
  channel: HostChannel,
  dataFolder: string,
  script: {name: string; text: string},
  cancellation: AbortSignal,
): Promise<RelayInstall> {
  const target = dataScriptPath(dataFolder, script.name, script.text);
  const written = await writeHostFile(
    channel,
    target,
    script.text,
    '0644',
    cancellation,
  );
  if (written.kind === 'written') {
    return {kind: 'written', path: target};
  }
  return written.kind === 'failed'
    ? written
    : {
        kind: 'failed',
        detail: `${script.name} script not written (exit ${String(written.status)})`,
      };
}

/** Writes the relay script into the data folder. */
export function installRelayScript(
  channel: HostChannel,
  dataFolder: string,
  cancellation: AbortSignal,
): Promise<RelayInstall> {
  return installDataScript(
    channel,
    dataFolder,
    {name: 'relay', text: RELAY_SCRIPT},
    cancellation,
  );
}

/** Whether `folder` exists in the target, as the channel's user sees it; an error of the channel counts as it not existing. */
export async function folderExistsOver(
  channel: HostChannel,
  folder: string,
  cancellation: AbortSignal,
): Promise<boolean> {
  const outcome = await channel.runScript(
    {
      script: `[ -e ${posixQuote(folder)} ]`,
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: ''},
      cancellation,
    },
    () => undefined,
  );
  return outcome.kind === 'exited' && outcome.status === 0;
}
