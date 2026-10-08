/**
 * @fileoverview A registry file port that keeps its files in memory, for tests.
 */

import type {RegistryFilePort} from '../registry/file-port.ts';

/** The files by path; `createExclusive` checks and creates in one step. */
export class MemoryFilePort implements RegistryFilePort {
  readonly files = new Map<string, string>();

  /** Creates the file unless the path is taken. */
  createExclusive(path: string, text: string): Promise<'created' | 'exists'> {
    if (this.files.has(path)) {
      return Promise.resolve('exists');
    }
    this.files.set(path, text);
    return Promise.resolve('created');
  }

  /** The file's text, if the path is taken. */
  read(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  /** Frees the path. */
  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }
}
