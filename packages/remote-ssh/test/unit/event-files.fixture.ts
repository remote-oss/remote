/**
 * @fileoverview The event files in memory, shared by the windows of one row.
 */

import path from 'node:path';
import type {EventFiles} from '../../src/state/event-files.ts';

/** A file system in memory, shared by the windows of one row, whose files carry the time they were last written. */
export class MemoryFiles implements EventFiles {
  readonly files = new Map<string, {text: string; modified: number}>();
  readonly operations: string[] = [];
  clock = 1000;
  failWrites = false;
  private count = 0;

  /** Makes nothing: a folder is there once a file is. */
  makeFolder(): void {
    // A folder in memory needs no making.
  }

  /** The names of the files directly in `inFolder`. */
  names(inFolder: string): string[] {
    return [...this.files.keys()]
      .filter(file => path.dirname(file) === inFolder)
      .map(file => path.basename(file));
  }

  /** The text of `file`, if there is one. */
  read(file: string): string | undefined {
    return this.files.get(file)?.text;
  }

  /** Writes `file` whole, now. */
  write(file: string, text: string): void {
    if (this.failWrites) {
      throw new Error('the disk is full');
    }
    this.operations.push(`write ${path.basename(file)}`);
    this.files.set(file, {text, modified: this.clock});
  }

  /** Moves `source` over `target`, keeping its time; throws when `source` is gone. */
  rename(source: string, target: string): void {
    const found = this.files.get(source);
    if (found === undefined) {
      throw new Error(`ENOENT: ${source}`);
    }
    this.operations.push(
      `rename ${path.basename(source)} ${path.basename(target)}`,
    );
    this.files.delete(source);
    this.files.set(target, found);
  }

  /** Removes `file`. */
  remove(file: string): void {
    this.operations.push(`remove ${path.basename(file)}`);
    this.files.delete(file);
  }

  /** When `file` was last written. */
  modified(file: string): number | undefined {
    return this.files.get(file)?.modified;
  }

  /** A new hexadecimal name part. */
  random(): string {
    this.count += 1;
    return this.count.toString(16).padStart(4, '0');
  }
}
