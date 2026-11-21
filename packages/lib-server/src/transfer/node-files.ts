/**
 * @fileoverview The client's files on Node.js, for the transfer of a server archive: the file system port of the
 * library over `fs`. It makes no request.
 */

import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, mkdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {MANUAL_BOOTSTRAP_ARCHIVE} from 'lib-product';
import type {ClientFilePort} from './ports.ts';

/** The SHA-256 of a file, as lower-case hex. */
export async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** What the marker beside a staged archive holds: nine bytes that say the copy is whole. */
const STAGED_MARKER = 'complete\n';

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
  // The staging folder is kept after the install: one per attempt that finds the user's archive, and none once the
  // host has the server, so the folders are those of the attempts up to the first install.
  stage: async (source, folder) => {
    try {
      const stagingFolder = path.join(folder, `vsc_server_${randomUUID()}`);
      await mkdir(stagingFolder, {recursive: true});
      const archive = path.join(stagingFolder, MANUAL_BOOTSTRAP_ARCHIVE);
      await copyFile(source, archive);
      await writeFile(`${archive}.done`, STAGED_MARKER);
      return {kind: 'staged', archive};
    } catch (caught) {
      // The file system rejects with an Error whose message names the path and the cause.
      return {kind: 'failed', detail: (caught as Error).message};
    }
  },
};
