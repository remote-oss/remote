import type {Clock, LockFilePort} from '../locks/client-lock.ts';

/**
 * A lock file held in memory for tests: `createExclusive` is atomic per call (the first caller
 * wins), `remove` deletes it, and `ageMilliseconds` reports the age a test set on the file plus
 * the clock's advance since the test set it; a file a create left with no age set reports
 * zero. Every call is recorded in `calls`, the create's text among them.
 */
export class MemoryLockPort implements LockFilePort {
  /** The current lock files, by path. */
  private readonly present = new Set<string>();
  /** The age a test set on each present file, and the clock time it was set. */
  private readonly ages = new Map<string, {base: number; setAt: number}>();
  /** Every call in order: the method name and the path. */
  readonly calls: string[] = [];
  private readonly clock: Clock;

  /** Build the port; the clock times the file ages. */
  constructor(clock: Clock) {
    this.clock = clock;
  }

  /** Set a file's age: `ageMilliseconds` reports it plus the clock's advance since. */
  setAge(path: string, ageMilliseconds: number): void {
    this.ages.set(path, {base: ageMilliseconds, setAt: this.clock.now()});
  }

  /** The present files, as paths. */
  files(): readonly string[] {
    return [...this.present];
  }

  /**
   * Create the file if absent: `created` for the first caller, `exists` for a later one. The
   * text a create writes is recorded in `calls` and not kept on the file.
   */
  createExclusive(path: string, text: string): Promise<'created' | 'exists'> {
    this.calls.push(`createExclusive ${path} ${text}`);
    if (this.present.has(path)) {
      return Promise.resolve('exists');
    }
    this.present.add(path);
    this.ages.delete(path);
    return Promise.resolve('created');
  }

  /** The file's age as the test set it, grown by the clock; `undefined` when the file is absent. */
  ageMilliseconds(path: string): Promise<number | undefined> {
    this.calls.push(`ageMilliseconds ${path}`);
    if (!this.present.has(path)) {
      return Promise.resolve(undefined);
    }
    const recorded = this.ages.get(path);
    return Promise.resolve(
      recorded === undefined
        ? 0
        : recorded.base + this.clock.now() - recorded.setAt,
    );
  }

  /** Delete the file, if present. */
  remove(path: string): Promise<void> {
    this.calls.push(`remove ${path}`);
    this.present.delete(path);
    this.ages.delete(path);
    return Promise.resolve();
  }
}
