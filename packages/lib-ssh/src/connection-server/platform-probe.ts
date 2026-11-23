/**
 * @fileoverview The opening of a session whose host's platform is unknown: four lines written to the host's own shell,
 * of which only cmd and PowerShell on Windows expand the second and third to one of the Windows answers, and the
 * reader of the answers. The first answers nothing: when a LocalCommand's last words with no line end reach the output
 * after it, they join that line, never an answer. Every
 * line carries the connection's nonce, and only a whole output line that is exactly one of the marked forms with that
 * nonce counts, so the echo of the input after a prompt, a banner, a message of the day, a prompt, an error or a line a
 * startup file prints never does.
 */

import {PlainTextFilter} from '../terminal/plain-text.ts';

/** What the opening found: the session goes on as a Windows one or as a POSIX one. */
export type DetectedPlatform = 'windows' | 'posix';

/** The start of every probe line of the connection whose nonce is `nonce`. */
function probeMark(nonce: string): string {
  return `REMOTE-OSS-PROBE-${nonce}-`;
}

/** The start of the home line of the connection whose nonce is `nonce`, whose rest is the expanded `$HOME`. */
function homeMark(nonce: string): string {
  return `REMOTE-OSS-HOME-${nonce}-`;
}

/** What follows the home line's start when PowerShell expanded `$HOME` on Windows: a drive path. */
const WINDOWS_HOME = /^[A-Za-z]:\\/;

/** The lines the session's shell reads first when the platform is unknown, with the connection's `nonce`. */
export function platformProbeInput(nonce: string): string {
  return [
    `echo ${probeMark(nonce)}START`,
    `echo ${probeMark(nonce)}%OS%`,
    `echo ${homeMark(nonce)}$HOME`,
    `echo ${probeMark(nonce)}DONE`,
    '',
  ].join('\n');
}

/**
 * The line a POSIX shell reads once it answered: it prints the hand-over line of the connection's `nonce`, then gives the
 * session to `program`, the bootstrap's reader.
 */
export function probeHandOverLine(nonce: string, program: string): string {
  return `echo ${probeMark(nonce)}EXEC; exec ${program}\n`;
}

/**
 * `line` without the carriage return of a CRLF ending and without terminal control sequences, which PowerShell 7 prints
 * in front of its output.
 */
function bareLine(line: string): string {
  return new PlainTextFilter().push(line.replace(/\r$/, ''));
}

/** Reads the session's output lines until the answers of the connection's nonce end, and gives the platform they show then. */
export class PlatformProbeReader {
  private readonly nonce: string;
  private windows = false;

  /** A reader of the answers to the probe of the connection whose nonce is `nonce`. */
  constructor(nonce: string) {
    this.nonce = nonce;
  }

  /** One output line; the platform once the answers ended, nothing before. */
  hear(line: string): DetectedPlatform | undefined {
    const bare = bareLine(line);
    const home = homeMark(this.nonce);
    if (bare === `${probeMark(this.nonce)}Windows_NT`) {
      this.windows = true;
    } else if (
      bare.startsWith(home) &&
      WINDOWS_HOME.test(bare.slice(home.length))
    ) {
      this.windows = true;
    } else if (bare === `${probeMark(this.nonce)}DONE`) {
      return this.windows ? 'windows' : 'posix';
    }
    return undefined;
  }
}

/**
 * Whether `line` is a whole answer line of the probe of the connection's `nonce`. Only the host's shell can print one,
 * since nothing before the session knows the nonce, so one shows that ssh entered the session.
 */
export function isProbeAnswer(line: string, nonce: string): boolean {
  const bare = bareLine(line);
  return bare.startsWith(probeMark(nonce)) || bare.startsWith(homeMark(nonce));
}

/** Whether `line` is the one a POSIX shell prints right before it gives the session to the bootstrap's reader. */
export function isProbeExecLine(line: string, nonce: string): boolean {
  return bareLine(line) === `${probeMark(nonce)}EXEC`;
}

/** ssh's `-v` line that says it entered the session: the host's output can only come after it. */
const SESSION_ENTERED = 'debug1: Entering interactive session.';

/** Whether `line` of ssh's own output says it entered the session. */
export function isSessionEntered(line: string): boolean {
  return line.replace(/\r$/, '') === SESSION_ENTERED;
}
