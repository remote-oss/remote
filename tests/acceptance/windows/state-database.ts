/**
 * @fileoverview Reads the editor's state database (`state.vscdb`) between the editor's own writes: the readers of the
 * hint store and of the global state share it.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

/** How long a read may take in all, in milliseconds: the editor's writer keeps its journal for a moment while it writes. */
const STATE_READ_MILLISECONDS = 5000;

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

/** One file beside the database as the failure of a read names it: its name, its size and how long ago it was last changed. */
function describedFile(directory: string, name: string): string {
  try {
    const stat = statSync(path.join(directory, name));
    return `${name} (${String(stat.size)} bytes, changed ${String(Date.now() - stat.mtimeMs)} ms ago)`;
  } catch {
    return `${name} (gone)`;
  }
}

/** The processes that hold one of `files` open, by their process id and command line; Linux only, and none where /proc is not readable. */
function holdersOf(files: readonly string[]): string[] {
  const holders: string[] = [];
  try {
    for (const processId of readdirSync('/proc').filter(entry =>
      /^\d+$/.test(entry),
    )) {
      try {
        const open = readdirSync(`/proc/${processId}/fd`).some(descriptor => {
          try {
            return files.includes(
              readlinkSync(`/proc/${processId}/fd/${descriptor}`),
            );
          } catch {
            return false;
          }
        });
        if (open) {
          const command = readFileSync(`/proc/${processId}/cmdline`, 'utf8')
            .split('\0')
            .join(' ')
            .slice(0, 100);
          holders.push(`${processId}: ${command}`);
        }
      } catch {
        // A process that ended or that this one may not look into holds nothing that can be named.
      }
    }
  } catch {
    // No /proc: the holders are not known.
  }
  return holders;
}

/**
 * What the failure of a read names of the database's surroundings: the files beside it with their sizes and ages (a
 * journal that is old is left over by an interrupted write, a fresh one is a writer's), the processes that hold them
 * open, and the journal mode when that can be read.
 */
function aroundDatabase(file: string): string {
  const directory = path.dirname(file);
  let files: string[] = [];
  try {
    files = readdirSync(directory).filter(name =>
      name.startsWith(path.basename(file)),
    );
  } catch {
    // The folder is the failure's own: the files beside it are not known.
  }
  let mode = 'unknown';
  try {
    const database = new DatabaseSync(unlockedUri(file), {readOnly: true});
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
  return `the files beside it: ${JSON.stringify(files.map(name => describedFile(directory, name)))}; the processes holding them open: ${JSON.stringify(holdersOf(files.map(name => path.join(directory, name))))}; its journal mode: ${mode}`;
}

/**
 * The address of `file` for a connection that takes no lock on it (`immutable`): the harness only looks at the editor's
 * database, and a lock of its own on it is not harmless. A writer that cannot commit because a reader holds a shared
 * lock fails with SQLITE_BUSY and, if its caller does not retry, keeps its transaction and blocks every reader after it
 * until it does, which is how a harness's reads lock the editor out (the 'database is locked' of #2420) and lose its
 * write (the memento that reverts, #2326).
 */
function unlockedUri(file: string): string {
  return `file:${pathToFileURL(file).pathname}?mode=ro&immutable=1`;
}

/** What `file` is at this moment as far as a read is concerned: its size and its change time. */
function stampOf(file: string): string {
  const stat = statSync(file);
  return `${String(stat.size)}:${String(stat.mtimeMs)}`;
}

/** The reason a read gave up on an attempt: a writer was between its first write and its commit. */
class WriterBusy extends Error {}

/**
 * Runs `read` on a connection to the state database `file` that takes no lock, and gives its result. Without a lock a
 * read is sound only while no writer is between its first write and its commit: the database file changes only at the
 * commit, after the writer's rollback journal exists. So an attempt reads only when the journal is absent before and
 * after it and the database file is the same size and age after it as before; otherwise it pauses and tries again. The
 * attempts end after {@link STATE_READ_MILLISECONDS}, and the failure then names why the last one gave up, the files
 * beside the database with their ages, the processes holding them open and its journal mode.
 */
export function readStateDatabase<Result>(
  file: string,
  read: (database: DatabaseSync) => Result,
  milliseconds = STATE_READ_MILLISECONDS,
): Result {
  const journal = `${file}-journal`;
  const deadline = Date.now() + milliseconds;
  for (let attempt = 1; ; attempt += 1) {
    try {
      if (existsSync(journal)) {
        throw new WriterBusy('a writer’s journal is present');
      }
      const before = stampOf(file);
      const database = new DatabaseSync(unlockedUri(file), {readOnly: true});
      let result: Result;
      try {
        result = read(database);
      } finally {
        database.close();
      }
      if (existsSync(journal) || stampOf(file) !== before) {
        throw new WriterBusy('a writer wrote while the database was read');
      }
      return result;
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
