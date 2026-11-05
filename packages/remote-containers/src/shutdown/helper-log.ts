/**
 * @fileoverview The helper's log lines: each goes to its error stream, which the extension that started it keeps, and,
 * when the line is about a connection that has a `shutdownMonitor` file, also to that file with its time.
 */

/** What the writer needs of the world. */
export interface HelperLogPorts {
  /** Writes `text` to the error stream. */
  stderr(text: string): void;
  /** Appends `text` to the file; a failure is the caller's to ignore. */
  append(file: string, text: string): void;
  /** The time of a line, in milliseconds since the epoch. */
  clock(): number;
}

/** The writer of the helper's lines over `ports`. */
export function helperLogOf(
  ports: HelperLogPorts,
): (line: string, logFile?: string) => void {
  return (line, logFile) => {
    ports.stderr(`${line}\n`);
    if (logFile !== undefined) {
      try {
        ports.append(
          logFile,
          `${new Date(ports.clock()).toISOString()} [info] ${line}\n`,
        );
      } catch {
        // The file is a convenience of the window; the helper's work does not depend on it.
      }
    }
  };
}
