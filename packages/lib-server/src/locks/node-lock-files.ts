/**
 * @fileoverview The client lock's files on Node.js: the lock port of the library over `fs`, each of whose calls has
 * done its work before it returns, and the removal the extension's end makes without waiting.
 */

import {closeSync, openSync, rmSync, statSync} from 'node:fs';
import type {LockFilePort} from './client-lock.ts';

/** The lock port, with the removal that does not wait, for an extension that is ending. */
export interface NodeLockFiles extends LockFilePort {
  /**
   * Removes the file at once while its modification time is `modified`; a failure is ignored, since the age rule
   * handles a file left behind.
   */
  removeNow(path: string, modified: number | undefined): void;
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

/** The modification time of the file at `path`; `undefined` when it is absent. */
function modifiedNow(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch (caught) {
    if (codeOf(caught) === 'ENOENT') {
      return undefined;
    }
    throw caught;
  }
}

/** Removes the file at `path` while its modification time is `modified`. */
function removedIfModified(path: string, modified: number | undefined): void {
  if (modified !== undefined && modifiedNow(path) === modified) {
    rmSync(path, {force: true});
  }
}

/** What `work` gives, as a promise settled with its value or its error once it has run. */
function settled<T>(work: () => T): Promise<T> {
  return new Promise(resolve => {
    resolve(work());
  });
}

/** The client lock's files on this machine. */
export const nodeLockFiles: NodeLockFiles = {
  createExclusive: path => settled(() => createdNow(path)),
  ageMilliseconds: path =>
    settled(() => {
      const modified = modifiedNow(path);
      return modified === undefined ? undefined : Date.now() - modified;
    }),
  modifiedMilliseconds: path => settled(() => modifiedNow(path)),
  remove: path =>
    settled(() => {
      rmSync(path, {force: true});
    }),
  removeIfModified: (path, modified) =>
    settled(() => {
      removedIfModified(path, modified);
    }),
  removeNow: (path, modified) => {
    try {
      removedIfModified(path, modified);
    } catch {
      // Left for the age rule.
    }
  },
};
