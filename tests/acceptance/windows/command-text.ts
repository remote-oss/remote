/**
 * @fileoverview The text of a command run only to explain a failure: bounded in time and in size, so that the
 * explanation can never hang a row or bury the row's own failure.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** How long a command that explains a failure may run, in milliseconds. */
const EXPLAIN_TIMEOUT_MILLISECONDS = 30_000;

/** The most characters of one line. */
const LINE_CHARACTERS = 240;

/**
 * The standard output of `file` with its arguments, trimmed; when the command fails or runs past `timeoutMilliseconds` (the
 * child is killed), the words `could not be read` with the reason.
 */
export async function outputOrReason(
  file: string,
  commandWords: readonly string[],
  timeoutMilliseconds = EXPLAIN_TIMEOUT_MILLISECONDS,
): Promise<string> {
  try {
    const {stdout} = await execFileAsync(file, [...commandWords], {
      timeout: timeoutMilliseconds,
    });
    return stdout.trim();
  } catch (caught) {
    return `could not be read: ${String(caught)}`;
  }
}

/**
 * The last `limit` of `lines`, each cut to 240 characters, after a line `and K more` when K earlier lines were left
 * out; a list that is short enough comes back as it is.
 */
export function lastLines(lines: readonly string[], limit: number): string {
  const omitted = Math.max(0, lines.length - limit);
  const kept = lines
    .slice(omitted)
    .map(line =>
      line.length > LINE_CHARACTERS
        ? `${line.slice(0, LINE_CHARACTERS)}...`
        : line,
    );
  return (omitted > 0 ? [`and ${String(omitted)} more`, ...kept] : kept).join(
    '\n',
  );
}
