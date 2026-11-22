import type {Clock, LockFilePort} from '../locks/client-lock.ts';

/**
 * A lock file held in memory for tests: `createExclusive` is atomic per call (the first caller
 * wins), `remove` deletes it, and a file's modification time is the clock's time at its create,
 * or the time a test set its age at less that age; `ageMilliseconds` is the clock's time since
 * then. Every call is recorded in `calls`.
 */
export class MemoryLockPort implements LockFilePort {
  /** The current lock files, by path. */
  private readonly present = new Set<string>();
  /** The modification time of each present file. */
  private readonly modified = new Map<string, number>();
  /** Every call in order: the method name and the path. */
  readonly calls: string[] = [];
  private readonly clock: Clock;

  /** Build the port; the clock times the file ages. */
  constructor(clock: Clock) {
    this.clock = clock;
  }

  /** Set a file's age: `ageMilliseconds` reports it plus the clock's advance since. */
  setAge(path: string, ageMilliseconds: number): void {
    this.modified.set(path, this.clock.now() - ageMilliseconds);
  }

  /** The present files, as paths. */
  files(): readonly string[] {
    return [...this.present];
  }

  /** Create the file if absent: `created` for the first caller, `exists` for a later one. */
  createExclusive(path: string): Promise<'created' | 'exists'> {
    this.calls.push(`createExclusive ${path}`);
    if (this.present.has(path)) {
      return Promise.resolve('exists');
    }
    this.present.add(path);
    this.modified.set(path, this.clock.now());
    return Promise.resolve('created');
  }

  /** The file's age by the clock; `undefined` when the file is absent. */
  ageMilliseconds(path: string): Promise<number | undefined> {
    this.calls.push(`ageMilliseconds ${path}`);
    const modified = this.modifiedOf(path);
    return Promise.resolve(
      modified === undefined ? undefined : this.clock.now() - modified,
    );
  }

  /** The file's modification time; `undefined` when the file is absent. */
  modifiedMilliseconds(path: string): Promise<number | undefined> {
    this.calls.push(`modifiedMilliseconds ${path}`);
    return Promise.resolve(this.modifiedOf(path));
  }

  /** Delete the file. */
  remove(path: string): Promise<void> {
    this.calls.push(`remove ${path}`);
    this.present.delete(path);
    this.modified.delete(path);
    return Promise.resolve();
  }

  /** Delete the file only while its modification time is `modified`. */
  removeIfModified(path: string, modified: number | undefined): Promise<void> {
    this.calls.push(`removeIfModified ${path}`);
    if (modified !== undefined && this.modifiedOf(path) === modified) {
      this.present.delete(path);
      this.modified.delete(path);
    }
    return Promise.resolve();
  }

  /** The modification time of a present file. */
  private modifiedOf(path: string): number | undefined {
    return this.present.has(path) ? this.modified.get(path) : undefined;
  }
}
