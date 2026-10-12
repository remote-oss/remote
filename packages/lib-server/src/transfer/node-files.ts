/**
 * @fileoverview The client's files on Node.js, for the transfer of a server archive: the file system port of the
 * library over `fs`. It makes no request.
 */

import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {rename, rm, stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import type {ClientFilePort} from './ports.ts';

/** The SHA-256 of a file, as lower-case hex. */
export async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** The client's files on this machine. */
export const nodeClientFiles: ClientFilePort = {
  remove: file => rm(file, {force: true}),
  exists: async file => {
    try {
      return (await stat(file)).isFile();
    } catch {
      return false;
    }
  },
  size: async file => (await stat(file)).size,
  sha256: sha256Of,
  rename: async (source, destination) => {
    try {
      await rename(source, destination);
      return {kind: 'renamed'};
    } catch (caught) {
      // The file system rejects with an Error whose message names the path and the cause.
      return {kind: 'failed', detail: (caught as Error).message};
    }
  },
};
