/**
 * @fileoverview The opening of a session whose host's platform is unknown: three lines written to the host's own shell,
 * which only cmd and PowerShell on Windows expand to one of the Windows answers, and the reader of the answers. Only a
 * whole output line that is exactly one of the marked forms counts, so the echo of the input after a prompt, a banner,
 * a message of the day, a prompt or an error never does.
 */

import {PlainTextFilter} from '../terminal/plain-text.ts';

/** What the opening found: the session goes on as a Windows one or as a POSIX one. */
export type DetectedPlatform = 'windows' | 'posix';

/** The lines the session's shell reads first when the platform is unknown. */
export const PLATFORM_PROBE_INPUT =
  'echo REMOTE-OSS-PROBE-%OS%\necho REMOTE-OSS-HOME-$HOME\necho REMOTE-OSS-PROBE-DONE\n';

/** The line a POSIX shell prints right before it gives the session to the bootstrap's reader. */
export const PROBE_EXEC_LINE = 'REMOTE-OSS-PROBE-EXEC';

/** The line cmd prints for the first input line: `%OS%` expanded. */
const CMD_ANSWER = 'REMOTE-OSS-PROBE-Windows_NT';

/** The start of the line of the second input line, whose rest is the expanded `$HOME`. */
const HOME_ANSWER = 'REMOTE-OSS-HOME-';

/** What follows `HOME_ANSWER` when PowerShell expanded `$HOME` on Windows: a drive path. */
const WINDOWS_HOME = /^[A-Za-z]:\\/;

/** The line of the third input line, which ends the answers. */
const DONE_ANSWER = 'REMOTE-OSS-PROBE-DONE';

/**
 * `line` without the carriage return of a CRLF ending and without terminal control sequences, which PowerShell 7 prints
 * in front of its output.
 */
function bareLine(line: string): string {
  return new PlainTextFilter().push(line.replace(/\r$/, ''));
}

/** Reads the session's output lines until the answers end, and gives the platform they show then. */
export class PlatformProbeReader {
  private windows = false;

  /** One output line; the platform once the answers ended, nothing before. */
  hear(line: string): DetectedPlatform | undefined {
    const bare = bareLine(line);
    if (bare === CMD_ANSWER) {
      this.windows = true;
    } else if (
      bare.startsWith(HOME_ANSWER) &&
      WINDOWS_HOME.test(bare.slice(HOME_ANSWER.length))
    ) {
      this.windows = true;
    } else if (bare === DONE_ANSWER) {
      return this.windows ? 'windows' : 'posix';
    }
    return undefined;
  }
}

/** Whether `line` is the one a POSIX shell prints right before it gives the session to the bootstrap's reader. */
export function isProbeExecLine(line: string): boolean {
  return bareLine(line) === PROBE_EXEC_LINE;
}
