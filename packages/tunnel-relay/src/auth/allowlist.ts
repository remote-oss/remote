/**
 * @fileoverview The accounts the relay admits: a file of numeric GitHub ids, one per line, with `#` comments, kept by the
 * relay's operator. It is read again whenever its modification time changes.
 */

/** What the allowlist reads of its file. */
export interface AllowlistFile {
  /** The file's modification time in milliseconds. */
  modified(): number;
  /** The file's text. */
  text(): string;
}

/** The admitted accounts, read from their file. */
export class Allowlist {
  private readonly file: AllowlistFile;
  private admitted = new Set<number>();
  private readAt = Number.NaN;

  /** The allowlist in `file`. */
  constructor(file: AllowlistFile) {
    this.file = file;
  }

  /** Whether the account with numeric id `accountId` is admitted. */
  admits(accountId: number): boolean {
    const modified = this.file.modified();
    if (modified !== this.readAt) {
      this.admitted = idsIn(this.file.text());
      this.readAt = modified;
    }
    return this.admitted.has(accountId);
  }
}

/** The numeric ids of `text`, one per line, after `#` comments are dropped. */
function idsIn(text: string): Set<number> {
  return new Set(
    text
      .split('\n')
      .map(line => line.replace(/#.*$/, '').trim())
      .filter(line => /^\d+$/.test(line))
      .map(Number),
  );
}
