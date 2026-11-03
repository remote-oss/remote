/**
 * @fileoverview The profile's global state as the editor keeps it on disk, and the entries of the Remote - SSH
 * extension in it, read between the editor's writes.
 */

import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {variable} from './harness.ts';

/** The entries of the profile's global state, by key: the editor's `state.vscdb`, read between its writes. */
async function globalState(): Promise<Map<string, string>> {
  const file = path.join(
    variable('HARNESS_USER_DATA'),
    'User/globalStorage/state.vscdb',
  );
  for (let attempt = 1; ; attempt += 1) {
    const database = new DatabaseSync(file, {readOnly: true});
    try {
      const rows = database
        .prepare('SELECT key, value FROM ItemTable')
        .all() as Array<{key: string; value: string}>;
      return new Map(rows.map(entry => [entry.key, entry.value]));
    } catch (caught) {
      if (attempt === 20) {
        throw caught;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    } finally {
      database.close();
    }
  }
}

/** The names whose entry differs between `before` and `after`, added, changed or removed, sorted. */
export function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
}

/** The Remote - SSH extension's global state: the entries it stored under its own key, by name. */
export async function extensionState(): Promise<Record<string, unknown>> {
  const stored = (await globalState()).get('remote-oss.remote-ssh');
  return stored === undefined
    ? {}
    : (JSON.parse(stored) as Record<string, unknown>);
}
