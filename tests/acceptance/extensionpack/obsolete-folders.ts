/**
 * @fileoverview The .obsolete file the editor's core writes while an uninstall runs, naming the extension folders to
 * delete at its next start. A row that waits for a folder to be marked for deletion reads the file in a wait: a read
 * that lands while core writes it gets a partial text, and such a text is the wait's "not yet" (card #3237), bounded
 * by the wait's own limit, which names it on timeout.
 */

import {existsSync, readFileSync} from 'node:fs';

/** A read of a .obsolete that met the editor's writer mid-write: the wait's "not yet", naming the text it read. */
export class ObsoleteNotYet extends Error {
  /** The mark the wait's runner reads to keep waiting rather than fail the row. */
  readonly notYet = true;
}

/**
 * The extension folders marked for deletion in the .obsolete file `file`, which its absence lists as none. A text that
 * does not parse is the wait's "not yet", naming the text; any other error of the read stands.
 */
export function obsoleteFoldersOf(file: string): string[] {
  if (!existsSync(file)) {
    return [];
  }
  const text = readFileSync(file, 'utf8');
  try {
    return Object.keys(JSON.parse(text) as object).toSorted();
  } catch (failure) {
    if (failure instanceof SyntaxError) {
      throw new ObsoleteNotYet(`the .obsolete does not parse: ${text}`);
    }
    throw failure;
  }
}
