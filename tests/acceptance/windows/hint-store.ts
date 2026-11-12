/**
 * @fileoverview The hint store the extension keeps in its global state, read from the profile's state database by a
 * row of a launch whose editor writes it to disk.
 */

import path from 'node:path';
import {variable} from './harness.ts';
import {aroundDatabase, readStateDatabase} from './state-database.ts';

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

/** The records of the hint store the extension keeps in its global state; none before it writes one. */
export function hintRecords(): HintRecords {
  console.log(
    `#2420: ${aroundDatabase(path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'))}`,
  );
  return readStateDatabase(
    path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'),
    database => {
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
    },
  );
}
