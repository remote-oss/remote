/**
 * @fileoverview secret-search: the files of a place on the client that hold any of a set of values, read byte for byte
 * and following no link. It says where a value is, never which value.
 */

import {lstatSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

/**
 * The regular files under `place` (a folder, searched at every depth, or a file) whose bytes contain any of `values`
 * and that `accepted` takes, sorted; none for a place that does not exist. A link is never followed.
 */
export function filesHolding(
  values: readonly string[],
  place: string,
  accepted: (file: string) => boolean = () => true,
): string[] {
  const needles = values.map(value => Buffer.from(value, 'utf8'));
  const found: string[] = [];
  visit(place);
  return found.sort();

  /** Adds `entry` to what was found when it is an accepted file that holds a value; a folder is visited at every depth. */
  function visit(entry: string): void {
    let stat;
    try {
      stat = lstatSync(entry);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(entry)) {
        visit(path.join(entry, name));
      }
    } else if (stat.isFile() && accepted(entry)) {
      const bytes = readFileSync(entry);
      if (needles.some(needle => bytes.includes(needle))) {
        found.push(entry);
      }
    }
  }
}
