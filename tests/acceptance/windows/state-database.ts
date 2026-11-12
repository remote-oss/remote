/**
 * @fileoverview Reads the editor's state database (`state.vscdb`) between the editor's own writes: the readers of the
 * hint store and of the global state share it.
 */

import {readdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

/** How long a read may take in all, in milliseconds: the editor holds the database for a moment while it writes. */
export const STATE_READ_MILLISECONDS = 5000;

/** How long SQLite itself waits for a lock inside one attempt, in milliseconds. */
const BUSY_MILLISECONDS = 1000;

/** The pause between two attempts, in milliseconds. */
const PAUSE_MILLISECONDS = 100;

/** Waits `milliseconds` on the thread: the readers are synchronous. */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** What SQLite said of a failure: its result code and message, when the error carries them. */
function sqliteSaid(caught: unknown): string {
  const code = (caught as {errcode?: unknown}).errcode;
  const said = (caught as {errstr?: unknown}).errstr;
  const text =
    typeof said === 'string'
      ? said
      : caught instanceof Error
        ? caught.message
        : 'no message';
  return `${typeof code === 'number' ? `code ${String(code)}: ` : ''}${text}`;
}

/** The files beside the database, and its journal mode when that can be read: what the failure of a read names. */
export function aroundDatabase(file: string): string {
  let files: string[] = [];
  try {
    files = readdirSync(path.dirname(file)).filter(name =>
      name.startsWith(path.basename(file)),
    );
  } catch {
    // The folder is the failure's own: the files beside it are not known.
  }
  let mode = 'unknown';
  try {
    const database = new DatabaseSync(file, {readOnly: true});
    try {
      mode = String(
        (
          database.prepare('PRAGMA journal_mode').get() as
            {journal_mode?: unknown} | undefined
        )?.journal_mode,
      );
    } finally {
      database.close();
    }
  } catch {
    // A locked database does not say its mode: the files beside it do.
  }
  return `the files beside it: ${JSON.stringify(files)}; its journal mode: ${mode}`;
}

/**
 * Runs `read` on a read-only connection to the state database `file`, and gives its result. SQLite waits for the lock
 * itself, up to a second per attempt; the attempts end after {@link STATE_READ_MILLISECONDS}, and the failure then names
 * SQLite's code and message, the files beside the database and its journal mode.
 */
export function readStateDatabase<Result>(
  file: string,
  read: (database: DatabaseSync) => Result,
  milliseconds = STATE_READ_MILLISECONDS,
): Result {
  const deadline = Date.now() + milliseconds;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const database = new DatabaseSync(file, {
        readOnly: true,
        timeout: Math.max(
          1,
          Math.min(BUSY_MILLISECONDS, deadline - Date.now()),
        ),
      });
      try {
        return read(database);
      } finally {
        database.close();
      }
    } catch (caught) {
      if (Date.now() >= deadline) {
        throw new Error(
          `the state database ${file} could not be read in ${String(milliseconds)} ms (${String(attempt)} attempts): ${sqliteSaid(caught)}; ${aroundDatabase(file)}`,
          {cause: caught},
        );
      }
      pause(PAUSE_MILLISECONDS);
    }
  }
}
