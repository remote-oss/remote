import type {RegistryFilePort} from '../registry/file-port.ts';

/** One call the port saw, in the order seen, so a test can assert the sequence. */
export interface FilePortCall {
  operation: 'createExclusive' | 'read' | 'remove';
  path: string;
}

/**
 * An in-memory file port for tests: files are strings keyed by path, `createExclusive` is
 * atomic per call (a second create for a path returns `exists`), and every call is recorded so
 * a test can assert the exact sequence.
 */
export class MemoryFilePort implements RegistryFilePort {
  /** The files, keyed by path. */
  readonly files = new Map<string, string>();

  /** Every call, in order. */
  readonly calls: FilePortCall[] = [];

  /** Create the file if none exists; the create and the existence check are one step. */
  createExclusive(path: string, text: string): Promise<'created' | 'exists'> {
    this.calls.push({operation: 'createExclusive', path});
    if (this.files.has(path)) {
      return Promise.resolve('exists');
    }
    this.files.set(path, text);
    return Promise.resolve('created');
  }

  /** The file's text, or nothing when the path holds no file. */
  read(path: string): Promise<string | undefined> {
    this.calls.push({operation: 'read', path});
    return Promise.resolve(this.files.get(path));
  }

  /** Remove the file; a path without a file is already clean. */
  remove(path: string): Promise<void> {
    this.calls.push({operation: 'remove', path});
    this.files.delete(path);
    return Promise.resolve();
  }
}
