/**
 * @fileoverview The harness's terminal mirror (card tooling-199, #2361): the reader of the file the log
 * terminal's mirror writes, so a row reads what the user would see, without the renderer.
 */

import {existsSync, readFileSync} from 'node:fs';

/** The escape the terminal uses to open its control sequences. */
const ESCAPE = '\u001b';

/** The ANSI sequences a mirrored line holds: a CSI to its final letter, an OSC to its terminator, or another two-byte escape. */
const ANSI = new RegExp(
  String.raw`${ESCAPE}(?:\[[0-9;?]*[A-Za-z]|\][^\u0007${ESCAPE}]*(?:\u0007|${ESCAPE}\\)|[@-Z\\-_])`,
  'g',
);

/**
 * The text of the mirror file `file` with its ANSI escapes stripped and its line ends as `\n`; `''`
 * when the file is empty or not there yet.
 */
export function terminalMirrorText(file: string): string {
  if (!existsSync(file)) {
    return '';
  }
  return readFileSync(file, 'utf8')
    .replaceAll(ANSI, '')
    .replaceAll('\r\n', '\n');
}

/**
 * The lines of the mirror file `file`: its text split on its newlines, so an empty middle line holds
 * and a final line that the file ends without a newline still holds; none for an empty file.
 */
export function terminalMirrorLines(file: string): string[] {
  const text = terminalMirrorText(file);
  if (text === '') {
    return [];
  }
  const lines = text.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}
