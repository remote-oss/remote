/**
 * @fileoverview What a finished `docker exec` means for a script and for a copy: the Docker client's own errors are a
 * closed channel, the tar tool's absence is its own kind, and any other status of a script is the script's result.
 */

import type {CopyOutcome, ScriptOutcome} from 'lib-host';

/** The lines of `stderr` that are not empty. */
function linesOf(stderr: string): string[] {
  return stderr.split('\n').filter(line => line.trim() !== '');
}

/** Whether a line is the Docker client reporting the container, not the command in it. */
function isDaemonLine(line: string): boolean {
  return (
    line.startsWith('Error response from daemon:') ||
    line.startsWith('Error: No such container:') ||
    line.includes('is not running')
  );
}

/** The failure of `kind` with `detail` as the outcome of either operation. */
function failed(
  kind: 'channelClosed' | 'copyToolMissing' | 'copyFailed',
  detail: string,
): {kind: 'failed'; failure: {kind: typeof kind; detail: string}} {
  return {kind: 'failed', failure: {kind, detail}};
}

/** What a finished `docker exec` of a script means. */
export function exitOutcome(
  status: number | undefined,
  stderr: string,
  operation: 'script',
): ScriptOutcome;
/** What a finished `docker exec` of a copy means. */
export function exitOutcome(
  status: number | undefined,
  stderr: string,
  operation: 'copy',
): CopyOutcome;
export function exitOutcome(
  status: number | undefined,
  stderr: string,
  operation: 'script' | 'copy',
): ScriptOutcome | CopyOutcome {
  const lines = linesOf(stderr);
  const daemon = lines.filter(isDaemonLine);
  const last = lines.at(-1);
  if (daemon.length > 0) {
    return failed('channelClosed', daemon.join('\n'));
  }
  if (status === 125) {
    return failed('channelClosed', last ?? 'docker exit 125');
  }
  if (status === undefined) {
    return failed('channelClosed', 'docker ended by a signal');
  }
  if (operation === 'script') {
    return {kind: 'exited', status};
  }
  if (status === 0) {
    return {kind: 'copied'};
  }
  if (status === 126 || status === 127) {
    return failed('copyToolMissing', last ?? `tar exit ${String(status)}`);
  }
  return failed('copyFailed', last ?? `tar exit ${String(status)}`);
}
