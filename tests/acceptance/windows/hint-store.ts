/**
 * @fileoverview The hint store the extension keeps in its global state, read from the profile's state database by a
 * row of a launch whose editor writes it to disk.
 */

import path from 'node:path';
import {variable, waitFor} from './harness.ts';
import {readStateDatabase} from './state-database.ts';

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

/** The newest record of the hint store as text, for a failure to show; what cannot be read says so. */
function newestRecord(): string {
  try {
    return JSON.stringify(hintRecords().at(-1) ?? null);
  } catch (caught) {
    return `(unreadable: ${caught instanceof Error ? caught.message : 'no message'})`;
  }
}

/**
 * Waits as `waitFor` does, and when it fails names the newest record of the hint store as it is then: a record that
 * lacks what the wait is for and a store that cannot be read are told apart.
 */
export async function waitForRecords(
  description: string,
  check: () => boolean | Promise<boolean>,
  milliseconds: number,
): Promise<void> {
  await waitFor(description, check, milliseconds).catch((caught: unknown) => {
    throw new Error(
      `${caught instanceof Error ? caught.message : 'the wait failed'}; the newest record: ${newestRecord()}`,
      {cause: caught},
    );
  });
}
