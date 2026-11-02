/**
 * @fileoverview The log line of the connection helper: the helper is started with its streams ignored, so its lines
 * reach nothing on their own. When a log file is named (in an acceptance run) each line is also
 * appended to the extension's log file with a `[helper]` tag, so the lines of a helper that ended before its window
 * connected can be read. Every line is masked like the logger's own before it goes anywhere.
 */

import {redact} from 'lib-log';

/** What the line needs of its host: the error stream and the append to a file. */
export interface HelperLogPorts {
  write(text: string): void;
  append(file: string, text: string): void;
}

/**
 * The function that logs one line of the helper: to the error stream always, and to `file`, when there is one, as well. A file that cannot be written never stops the helper.
 */
export function helperLogLineOf(
  file: string | undefined,
  ports: HelperLogPorts,
): (line: string) => void {
  return line => {
    const masked = redact(line, []);
    ports.write(`${masked}\n`);
    if (file === undefined) {
      return;
    }
    try {
      ports.append(file, `[helper] ${masked}\n`);
    } catch {
      // The copy is for the acceptance runs: a file that cannot be written must never stop the helper.
    }
  };
}
