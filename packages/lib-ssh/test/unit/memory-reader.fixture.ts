/**
 * @fileoverview The configuration file port of the unit tests: a path-to-text map that the library reads as if it
 * were the client's file system.
 */

import path from 'node:path';
import type {ConfigFileReader} from '../../src/index.ts';

/**
 * A `ConfigFileReader` over a path-to-text map; `listFolder` is derived from the map's keys, and both lookups return
 * `undefined` for a missing path or a path that is not a readable folder.
 */
export function memoryReader(
  texts: ReadonlyMap<string, string>,
): ConfigFileReader {
  return {
    readText(file: string): string | undefined {
      return texts.get(file);
    },
    listFolder(folder: string): string[] | undefined {
      if (texts.has(folder)) {
        return undefined;
      }
      const entries = new Set<string>();
      for (const pathName of texts.keys()) {
        const base = path.posix.dirname(pathName);
        if (base === folder) {
          entries.add(path.posix.basename(pathName));
        }
      }
      return entries.size === 0 ? undefined : [...entries];
    },
  };
}
