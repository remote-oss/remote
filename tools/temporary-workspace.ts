/**
 * @fileoverview A repository tree in a temporary folder, for the tests of the repository tools.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

/** A temporary folder that a test fills with files and links and removes afterwards. */
export class TemporaryWorkspace {
  /** The absolute path of the folder. */
  readonly root: string;

  /** Creates the folder in the system's temporary directory, its name starting with `prefix`. */
  constructor(prefix: string) {
    this.root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  }

  /** Writes `content` to `file`, relative to the root; an object is written as JSON. */
  write(file: string, content: unknown): void {
    const fullPath = path.join(this.root, file);
    mkdirSync(path.dirname(fullPath), {recursive: true});
    writeFileSync(
      fullPath,
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }

  /** Writes packages/<folder>/package.json: a private package named after the folder, plus `fields`. */
  writeManifest(folder: string, fields: object = {}): void {
    this.write(`packages/${folder}/package.json`, {
      name: folder,
      version: '0.0.0',
      private: true,
      ...fields,
    });
  }

  /** Creates a relative symbolic link at `source` that points to `target`, both relative to the root. */
  link(source: string, target: string): void {
    const fullPath = path.join(this.root, source);
    mkdirSync(path.dirname(fullPath), {recursive: true});
    symlinkSync(
      path.relative(path.dirname(fullPath), path.join(this.root, target)),
      fullPath,
    );
  }

  /** Deletes the folder and everything in it. */
  remove(): void {
    rmSync(this.root, {recursive: true, force: true});
  }
}
