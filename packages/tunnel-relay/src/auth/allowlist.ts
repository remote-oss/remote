/**
 * @fileoverview The accounts the relay admits: a file of numeric GitHub ids, one per line, with `#` comments, kept by the
 * relay's operator. It is read again whenever its modification time changes, and each new reading is announced, so the
 * relay can close the legs of owners it no longer lists. Its first reading, at start, throws when the file can't be read
 * or holds a line that is neither an id nor a comment, since there is no list to keep. A later reading that fails the
 * same way keeps the last list: the failure is reported once per distinct failure, again when it changes, and its
 * recovery is told once, and no account is admitted or refused because of it.
 */

/** What the allowlist reads of its file. */
export interface AllowlistFile {
  /** The file's modification time in milliseconds. */
  modified(): number;
  /** The file's text. */
  text(): string;
}

/** What the allowlist tells: each new reading, and the failure or the recovery of a reading. */
export interface AllowlistHooks {
  onRead?: () => void;
  report?: (failure: unknown) => void;
  onRecovered?: () => void;
}

/** The admitted accounts, read from their file. */
export class Allowlist {
  private readonly file: AllowlistFile;
  private readonly hooks: AllowlistHooks;
  private admitted = new Set<number>();
  private readAt = Number.NaN;
  /** The message of the failure told last, so the same one is told once; the empty string when none is told. */
  private told = '';

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

  /** Reads the file, throwing when it can't be read or isn't a list of ids: the first reading, with no list to keep. */
  load(): void {
    const modified = this.file.modified();
    this.admitted = idsIn(this.file.text());
    this.readAt = modified;
    this.hooks.onRead?.();
  }

  /**
   * Reads the file again when its modification time changed; one it can't read, or that isn't a list, keeps the list.
   * A failure is told once per distinct failure, again when it changes, and its recovery once.
   */
  refresh(): void {
    try {
      if (this.file.modified() !== this.readAt) {
        this.load();
      }
    } catch (failure) {
      if (String(failure) !== this.told) {
        this.told = String(failure);
        this.hooks.report?.(failure);
      }
      return;
    }
    if (this.told !== '') {
      this.told = '';
      this.hooks.onRecovered?.();
    }
  }
}

/** The numeric ids of `text`, one per line, after `#` comments and blank lines are dropped; throws at any other line. */
function idsIn(text: string): Set<number> {
  const accounts = new Set<number>();
  for (const [index, line] of text.split('\n').entries()) {
    const entry = line.replace(/#.*$/, '').trim();
    if (entry === '') {
      continue;
    }
    if (!/^\d+$/.test(entry)) {
      throw new Error(
        `Line ${String(index + 1)} of the allowlist is not an account id: ${entry}`,
      );
    }
    accounts.add(Number(entry));
  }
  return accounts;
}
