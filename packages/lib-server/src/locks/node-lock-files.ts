/**
 * @fileoverview The client lock's files on Node.js: the lock port of the library over `fs`, whose create is made
 * before it returns, and the removal the extension's end makes without waiting.
 */

import {closeSync, openSync, rmSync} from 'node:fs';
import {rm, stat} from 'node:fs/promises';
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

/** Makes the empty file at `path` before returning: `exists` when another made it first. */
function createdNow(path: string): 'created' | 'exists' {
  try {
    closeSync(openSync(path, 'wx'));
    return 'created';
  } catch (caught) {
    if (codeOf(caught) === 'EEXIST') {
      return 'exists';
    }
    throw caught;
  }
}

/** The client lock's files on this machine. */
export const nodeLockFiles: NodeLockFiles = {
  createExclusive: path =>
    new Promise(resolve => {
      resolve(createdNow(path));
    }),
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
