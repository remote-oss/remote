/**
 * @fileoverview The hint store the extension keeps in its global state, read from the profile's state database by a
 * row of a launch whose editor writes it to disk.
 */

import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {variable} from './harness.ts';

/** The records of the hint store: when each connect started, and the hints it kept. */
export type HintRecords = Array<{
  started: string;
  hints: Array<{
    kind?: string;
    status?: string;
    statusNumber?: number;
    text?: string;
    message?: string;
    details?: string;
    mitigations?: string[];
    resources?: string[];
  }>;
}>;

/** Waits `milliseconds` without freeing the thread's other work: the editor holds the database for a moment while it writes. */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** The records of the hint store the extension keeps in its global state; none before it writes one. */
export function hintRecords(): HintRecords {
  for (let attempt = 1; ; attempt += 1) {
    const database = new DatabaseSync(
      path.join(
        variable('HARNESS_USER_DATA'),
        'User/globalStorage/state.vscdb',
      ),
      {readOnly: true},
    );
    try {
      const entry = database
        .prepare('SELECT value FROM ItemTable WHERE key = ?')
        .get('remote-oss.remote-ssh') as {value: string} | undefined;
      const store =
        entry === undefined
          ? undefined
          : ((JSON.parse(entry.value) as Record<string, unknown>)[
              'remote.ssh.hints'
            ] as {records?: HintRecords} | undefined);
      return store?.records ?? [];
    } catch (caught) {
      if (attempt === 20) {
        throw caught;
      }
      pause(250);
    } finally {
      database.close();
    }
  }
}
