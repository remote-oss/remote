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
    message?: string;
    details?: string;
    mitigations?: string[];
    resources?: string[];
  }>;
}>;

/** The records of the hint store the extension keeps in its global state; none before it writes one. */
export function hintRecords(): HintRecords {
  const database = new DatabaseSync(
    path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'),
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
  } finally {
    database.close();
  }
}
