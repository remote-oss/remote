/**
 * @fileoverview The local files a host channel streams to the host, as a port, and its Node.js form.
 */

import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';

/** Local files, as far as a host channel needs them. */
export interface LocalFiles {
  /** Whether a regular file exists at the path. */
  exists(file: string): Promise<boolean>;
  /** The file's bytes, in pieces, in order. */
  read(file: string): AsyncIterable<Uint8Array>;
}

/** The local files of this machine. */
export const nodeLocalFiles: LocalFiles = {
  exists: async file => {
    try {
      return (await stat(file)).isFile();
    } catch {
      // A path that cannot be examined names no file.
      return false;
    }
  },
  read: file => createReadStream(file),
};
