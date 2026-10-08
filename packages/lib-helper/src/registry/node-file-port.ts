/**
 * @fileoverview The registry's file port on Node.js: an exclusive create that fails when the file exists, so the
 * first writer of a record holds its key.
 */

import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {RegistryFilePort} from './file-port.ts';

function errorCode(caught: unknown): string | undefined {
  // The fs promises reject with Node.js system errors, which carry a code.
  return (caught as NodeJS.ErrnoException).code;
}

/** Record files on disk, readable and writable by the user only. */
export const nodeFilePort: RegistryFilePort = {
  async createExclusive(file, text) {
    await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    try {
      await writeFile(file, text, {flag: 'wx', mode: 0o600});
      return 'created';
    } catch (caught) {
      if (errorCode(caught) === 'EEXIST') {
        return 'exists';
      }
      throw caught;
    }
  },
  async read(file) {
    try {
      return await readFile(file, 'utf8');
    } catch (caught) {
      if (errorCode(caught) === 'ENOENT') {
        return undefined;
      }
      throw caught;
    }
  },
  async remove(file) {
    await rm(file, {force: true});
  },
};
