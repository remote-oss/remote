/**
 * @fileoverview The override file: the configuration text the pre-pass rewrote, written where only the user can read
 * it (it may hold substituted environment values) and removed after the run.
 */

import {randomBytes} from 'node:crypto';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Where override files are written and removed. */
export interface OverrideStore {
  /** Writes the text and gives the file's path. */
  write(text: string): Promise<string>;
  /** Removes the file; a file that is not there is not an error. */
  remove(file: string): Promise<void>;
}

/** The store in the extension's own storage folder. */
export function overrideStoreOf(storageFolder: string): OverrideStore {
  const folder = path.join(storageFolder, 'cli-overrides');
  return {
    write: async text => {
      await mkdir(folder, {recursive: true, mode: 0o700});
      const file = path.join(folder, `${randomBytes(8).toString('hex')}.json`);
      await writeFile(file, text, {mode: 0o600});
      return file;
    },
    remove: file => rm(file, {force: true}),
  };
}
