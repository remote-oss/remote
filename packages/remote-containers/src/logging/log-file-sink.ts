/**
 * @fileoverview The sink of the activation's log file: every line of the activation is appended to one
 * file, in the order it was written, and a write that fails is reported once and never stops the extension.
 */

import {defaultFormat, type LogLine, type Sink} from 'lib-log';

/** What the file needs of the file system. */
export interface LogFilePorts {
  /** Makes the log folder, with the folders on the way, when it is not there. */
  makeFolder(folder: string): Promise<void>;
  /** Appends `text` to the file, making the file when it is not there. */
  append(file: string, text: string): Promise<void>;
  /** Called once, with the reason, the first time the folder or an append fails. */
  failed(reason: string): void;
}

/** The sink of one log file, and the wait for everything written so far to reach it. */
export interface LogFileSink extends Sink {
  /** Resolves when every line written before the call has been appended, or has failed. */
  flushed(): Promise<void>;
}

/** The sink that appends the lines it is given, as `format` writes them, to `file` in `folder`. */
export function logFileSinkOf(
  ports: LogFilePorts,
  folder: string,
  file: string,
  format: (line: LogLine) => string = defaultFormat,
): LogFileSink {
  let reported = false;
  function report(error: unknown): void {
    if (!reported) {
      reported = true;
      ports.failed(String(error));
    }
  }
  let tail: Promise<void> = ports.makeFolder(folder).catch(report);
  return {
    write: line => {
      const text = `${format(line)}\n`;
      tail = tail.then(() => ports.append(file, text)).catch(report);
    },
    flushed: () => tail,
  };
}
