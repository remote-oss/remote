/**
 * @fileoverview The client lock's files on Node.js: the lock port of the library over `fs`, and the removal the
 * extension's end makes without waiting.
 */

import {rmSync} from 'node:fs';
import {open, rm, stat} from 'node:fs/promises';
import type {LockFilePort} from './client-lock.ts';

/** The lock port, with the removal that does not wait, for an extension that is ending. */
export interface NodeLockFiles extends LockFilePort {
  /** Removes the file at once; a failure is ignored, since the age rule handles a file left behind. */
  removeNow(path: string): void;
}

/** The code of a file system error. */
function codeOf(caught: unknown): unknown {
  return (caught as NodeJS.ErrnoException).code;
}

/** The client lock's files on this machine. */
export const nodeLockFiles: NodeLockFiles = {
  createExclusive: async path => {
    try {
      await (await open(path, 'wx')).close();
      return 'created';
    } catch (caught) {
      if (codeOf(caught) === 'EEXIST') {
        return 'exists';
      }
      throw caught;
    }
  },
  ageMilliseconds: async path => {
    try {
      return Date.now() - (await stat(path)).mtimeMs;
    } catch (caught) {
      if (codeOf(caught) === 'ENOENT') {
        return undefined;
      }
      throw caught;
    }
  },
  remove: path => rm(path, {force: true}),
  removeNow: path => {
    try {
      rmSync(path, {force: true});
    } catch {
      // Left for the age rule.
    }
  },
};
