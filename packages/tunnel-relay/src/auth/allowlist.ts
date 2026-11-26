/**
 * @fileoverview The accounts the relay admits: a file of numeric GitHub ids, one per line, with `#` comments, kept by the
 * relay's operator. It is read again whenever its modification time changes, and each new reading is announced, so the
 * relay can close the legs of owners it no longer lists. A file that can't be read keeps the last list: the failure is
 * reported, and no account is admitted or refused because of it.
 */

/** What the allowlist reads of its file. */
export interface AllowlistFile {
  /** The file's modification time in milliseconds. */
  modified(): number;
  /** The file's text. */
  text(): string;
}

/** What the allowlist tells: each new reading, and a file it could not read. */
export interface AllowlistHooks {
  onRead?: () => void;
  report?: (failure: unknown) => void;
}

/** The admitted accounts, read from their file. */
export class Allowlist {
  private readonly file: AllowlistFile;
  private readonly hooks: AllowlistHooks;
  private admitted = new Set<number>();
  private readAt = Number.NaN;

  /** The allowlist in `file`, telling `hooks` of each reading and of each failure to read. */
  constructor(file: AllowlistFile, hooks: AllowlistHooks = {}) {
    this.file = file;
    this.hooks = hooks;
  }

  /** Whether the account with numeric id `accountId` is admitted. */
  admits(accountId: number): boolean {
    this.refresh();
    return this.admitted.has(accountId);
  }

  /** Reads the file again when its modification time changed since the last reading; one it can't read keeps the list. */
  refresh(): void {
    let modified: number;
    let text: string;
    try {
      modified = this.file.modified();
      if (modified === this.readAt) {
        return;
      }
      text = this.file.text();
    } catch (failure) {
      this.hooks.report?.(failure);
      return;
    }
    this.admitted = idsIn(text);
    this.readAt = modified;
    this.hooks.onRead?.();
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
