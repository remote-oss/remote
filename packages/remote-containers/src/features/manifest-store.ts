/**
 * @fileoverview The kept copy of the control manifest: one file in the extension's global storage, whose modification
 * time is when the copy was kept.
 */

import {
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** The name of the kept copy. */
const KEPT_FILE = 'control-manifest.json';

/** The kept copy and the way to keep a new one, over the global storage folder `folder`. */
export function manifestStoreOf(folder: string): {
  kept(): {text: string; keptAt: number} | undefined;
  keep(text: string, keptAt: number): void;
} {
  const file = path.join(folder, KEPT_FILE);
  return {
    kept: () => {
      try {
        return {
          text: readFileSync(file, 'utf8'),
          keptAt: statSync(file).mtimeMs,
        };
      } catch {
        return undefined;
      }
    },
    keep: (text, keptAt) => {
      mkdirSync(folder, {recursive: true});
      writeFileSync(file, text);
      const time = new Date(keptAt);
      utimesSync(file, time, time);
    },
  };
}
