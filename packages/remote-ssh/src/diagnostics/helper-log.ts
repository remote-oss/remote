/**
 * @fileoverview The log line of the connection helper: the helper is started with its streams ignored, so its lines
 * reach nothing on their own. In an acceptance run (the harness's switch on, and a log file named) each line is also
 * appended to the extension's log file with a `[helper]` tag, so the lines of a helper that ended before its window
 * connected can be read.
 */

/** The variable whose value `1` switches the harness's adapters on. */
const SWITCH = 'REMOTE_OSS_ACCEPTANCE';

/** The variable that names the file the extension's log lines are copied to. */
const LOG_FILE_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_LOG';

/** What the line needs of its host: the error stream and the append to a file. */
export interface HelperLogPorts {
  write(text: string): void;
  append(file: string, text: string): void;
}

/**
 * The function that logs one line of the helper: to the error stream always, and, in an acceptance run, to the log
 * file as well. A file that cannot be written never stops the helper.
 */
export function helperLogLineOf(
  environment: Readonly<Record<string, string | undefined>>,
  ports: HelperLogPorts,
): (line: string) => void {
  const file = environment[LOG_FILE_VARIABLE];
  const copied =
    environment[SWITCH] === '1' && file !== undefined && file !== '';
  return line => {
    ports.write(`${line}\n`);
    if (!copied) {
      return;
    }
    try {
      ports.append(file, `[helper] ${line}\n`);
    } catch {
      // The copy is for the acceptance runs: a file that cannot be written must never stop the helper.
    }
  };
}
