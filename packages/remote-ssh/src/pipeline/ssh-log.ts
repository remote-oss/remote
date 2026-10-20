/**
 * @fileoverview ssh's own error-stream lines in the extension's log: each is marked `[ssh]`, the connection token is
 * masked, and the `debug1` lines of the client's `-v` are kept for the trace level alone, except the server host key's.
 * The lines are logged and never read.
 */

import type {Logger} from 'lib-log';
import {logLinesOf} from 'lib-ssh';
import {masked} from '../diagnostics/log-content.ts';

/** One line for the log: the level it is written at, and its text. */
export interface SshLogEntry {
  level: 'info' | 'trace';
  text: string;
}

/**
 * The entries for `lines`, in order. A line the debug level keeps is written at `info`, so both levels show it; any
 * other line is a `debug1` line, written at `trace`, so only that level shows it.
 */
export function sshLogEntries(
  lines: readonly string[],
  token: string | undefined,
): SshLogEntry[] {
  return lines.map(line => {
    const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
    return {
      level: logLinesOf([bare]).length === 1 ? 'info' : 'trace',
      text: `[ssh] ${masked(bare, token)}`,
    };
  });
}

/** Writes `lines` to `logger` as `sshLogEntries` gives them. */
export function logSshLines(
  logger: Pick<Logger, 'info' | 'trace'>,
  lines: readonly string[],
  token: string | undefined,
): void {
  for (const entry of sshLogEntries(lines, token)) {
    if (entry.level === 'info') {
      logger.info(entry.text);
    } else {
      logger.trace(entry.text);
    }
  }
}
