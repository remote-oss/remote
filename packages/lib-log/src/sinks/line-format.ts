import {escapeControls} from '../escape-controls.ts';
import type {LogLine} from '../logger.ts';
import {redact} from '../redaction.ts';

/** The terminal's code for the green class, the red class, and the end of either. */
const GREEN_CODE = '\u001b[32m';
const RED_CODE = '\u001b[31m';
const RESET_CODE = '\u001b[0m';

/** The time of a line in UTC to the millisecond, `YYYY-MM-DD HH:MM:SS.mmm`. */
function timestampOf(time: number): string {
  return new Date(time).toISOString().replace('T', ' ').replace('Z', '');
}

/** The message of a line, with the named secrets and the long runs redacted and the controls written as their code points. */
function bodyOf(line: LogLine, secrets: readonly string[]): string {
  return escapeControls(redact(line.message, secrets));
}

/** `[<timestamp>] <message>`, with no colour: the format of a log file. */
export function plainLineOf(
  line: LogLine,
  secrets: readonly string[] = [],
): string {
  return `[${timestampOf(line.time)}] ${bodyOf(line, secrets)}`;
}

/**
 * The line as a terminal shows it: the timestamp's digits are green, and a line from the standard error stream is red,
 * by the line's stream tag and never by its text. Every other part is the terminal's own colour.
 */
export function colouredLineOf(
  line: LogLine,
  secrets: readonly string[] = [],
): string {
  const body = bodyOf(line, secrets);
  return `[${GREEN_CODE}${timestampOf(line.time)}${RESET_CODE}] ${
    line.stream === 'stderr' ? `${RED_CODE}${body}${RESET_CODE}` : body
  }`;
}
