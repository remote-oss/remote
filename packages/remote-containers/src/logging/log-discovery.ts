/**
 * @fileoverview The log files of the profile: those of this activation's window and of every other session and window
 * that kept the extension's log, found from this window's log folder, which sits at
 * `<logs>/<session>/window<N>/exthost/<extension>`.
 */

import path from 'node:path';
import {type LogFile, parseLogFileName} from './log-files.ts';

/** What the search needs of the disk. */
export interface LogFolderPorts {
  /** The names in a folder; none when it cannot be read. */
  names(folder: string): Promise<string[]>;
  /** The size of a file in bytes; none when it cannot be read. */
  sizeOf(file: string): Promise<number | undefined>;
}

/** The name of a window's folder inside a session's. */
const WINDOW_FOLDER = /^window\d+$/u;

/** The log files of the extension in every session and window of the profile, sized as they are now. */
export async function logFilesOf(
  logFolder: string,
  ports: LogFolderPorts,
): Promise<LogFile[]> {
  const extension = path.basename(logFolder);
  const root = path.dirname(
    path.dirname(path.dirname(path.dirname(logFolder))),
  );
  const found: LogFile[] = [];
  for (const session of await ports.names(root)) {
    for (const window of await ports.names(path.join(root, session))) {
      if (!WINDOW_FOLDER.test(window)) {
        continue;
      }
      const folder = path.join(root, session, window, 'exthost', extension);
      for (const name of await ports.names(folder)) {
        const parsed = parseLogFileName(name);
        const file = path.join(folder, name);
        const size =
          parsed === undefined ? undefined : await ports.sizeOf(file);
        if (parsed !== undefined && size !== undefined) {
          found.push({...parsed, file, size});
        }
      }
    }
  }
  return found;
}
