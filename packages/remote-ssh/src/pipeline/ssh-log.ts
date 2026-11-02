/**
 * @fileoverview ssh's own error-stream lines in the extension's log: each is marked `[ssh]`, the connection token is
 * masked, and the `debug1` lines of the client's `-v` are kept for the trace level alone, except the server host key's.
 * The lines are logged; a logger that implements `sshLines` is handed each bare line after it is logged, and nothing else
 * reads them.
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

/** ssh's own lines for a channel or a forward: `channel <n>: open failed: …`, `connect_to … failed` and `Warning: …`. */
const FORWARDING_LINE = /^(?:channel \d+: |connect_to |Warning: )/;

/** Whether `line` is one of ssh's own lines for a channel or a forward, which stay in the log after authentication. */
export function isForwardingLine(line: string): boolean {
  return FORWARDING_LINE.test(line.endsWith('\r') ? line.slice(0, -1) : line);
}

/** A logger that may also want ssh's bare lines, once each is logged. */
export type SshLogger = Pick<Logger, 'info' | 'trace'> & {
  sshLines?(lines: readonly string[]): void;
};

/** Writes `lines` to `logger` as `sshLogEntries` gives them, each followed by the bare line for its `sshLines`. */
export function logSshLines(
  logger: SshLogger,
  lines: readonly string[],
  token: string | undefined,
): void {
  for (const line of lines) {
    for (const entry of sshLogEntries([line], token)) {
      if (entry.level === 'info') {
        logger.info(entry.text);
      } else {
        logger.trace(entry.text);
      }
    }
    logger.sshLines?.([line.endsWith('\r') ? line.slice(0, -1) : line]);
  }
}
