/**
 * @fileoverview The file system of `cli-bin` on the machine's own disk: a folder only the user can enter, and files
 * written whole under a name of their own.
 */

import {randomUUID} from 'node:crypto';
import {chmod, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import type {CliBinFs} from './cli-bin.ts';

/** The folder's mode: the user alone reads and writes it. */
const FOLDER_MODE = 0o700;

/** The file system of `cli-bin` over `node:fs`. */
export const nodeCliBinFs: CliBinFs = {
  readText: async file => {
    try {
      return await readFile(file, 'utf8');
    } catch {
      return undefined;
    }
  },
  makeFolder: async folder => {
    await mkdir(folder, {recursive: true, mode: FOLDER_MODE});
    // A folder made earlier, or under a different umask, is closed to the others as well.
    await chmod(folder, FOLDER_MODE);
  },
  writeText: (file, text, mode) => writeFile(file, text, {mode}),
  rename,
  unique: randomUUID,
};
