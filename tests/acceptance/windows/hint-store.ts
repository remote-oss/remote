/**
 * @fileoverview The connection hints the extension keeps, read from the files of its global storage folder by a row of a
 * launch whose editor writes them to disk, through the accessor the extension's README documents.
 */

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {variable, waitFor} from './harness.ts';
import {type HintRecords, HINTS_FOLDER, recordsOf} from './stored-hints.ts';

export type {HintRecords} from './stored-hints.ts';

/** The records of the hint store as the files of every window hold them; none before a window writes one. */
export function hintRecords(): HintRecords {
  const folder = path.join(variable('HARNESS_USER_DATA'), ...HINTS_FOLDER);
  return recordsOf(
    existsSync(folder)
      ? readdirSync(folder)
          .filter(name => /\.json$|\.claim-[0-9a-f]+$/.test(name))
          .flatMap(name => {
            try {
              return [readFileSync(path.join(folder, name), 'utf8')];
            } catch {
              return [];
            }
          })
      : [],
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
