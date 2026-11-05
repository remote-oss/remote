/**
 * @fileoverview Writing a whole text file on a host through its channel: beside the file first, then moved over it, so
 * a reader never sees a part of it.
 */

import {type HostChannel, posixQuote} from 'lib-host';

/** How a write ended: written, the script failed to run, or it ran and gave a failing status. */
export type HostFileWrite =
  | {kind: 'written'}
  | {kind: 'failed'; detail: string}
  | {kind: 'refused'; status: number | undefined};

/**
 * Writes `text` to `file` as the channel's user, creating its folder. With a `mode`, the file is created under umask
 * 022 and given that mode before it's moved into place.
 */
export async function writeHostFile(
  channel: HostChannel,
  file: string,
  text: string,
  mode: string | undefined,
  cancellation: AbortSignal,
): Promise<HostFileWrite> {
  const part = posixQuote(`${file}.part`);
  const outcome = await channel.runScript(
    {
      script: [
        'set -e',
        ...(mode === undefined ? [] : ['umask 022']),
        `mkdir -p ${posixQuote(file.slice(0, file.lastIndexOf('/')))}`,
        `cat > ${part}`,
        ...(mode === undefined ? [] : [`chmod ${mode} ${part}`]),
        `mv -f ${part} ${posixQuote(file)}`,
      ].join('\n'),
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text},
      cancellation,
    },
    () => undefined,
  );
  if (outcome.kind === 'failed') {
    return {kind: 'failed', detail: outcome.failure.detail};
  }
  return outcome.status === 0
    ? {kind: 'written'}
    : {kind: 'refused', status: outcome.status};
}
