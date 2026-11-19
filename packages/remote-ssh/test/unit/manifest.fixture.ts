/**
 * @fileoverview The JSON files of the package folder, which the rows that read the manifest share.
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';

const FOLDER = path.join(import.meta.dirname, '..', '..');

/** The JSON file of the package folder. */
export function jsonOf(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FOLDER, file), 'utf8')) as Record<
    string,
    unknown
  >;
}
