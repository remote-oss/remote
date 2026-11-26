/**
 * @fileoverview The `remote.SSH.remotePlatform` entry of the launch's user settings file, written by the extension
 * after a connect stores the picked platform. A row that waits for the entry to be written reads it in a wait: a
 * read that lands while the extension writes the file gets a half-written text, and such a text is the wait's
 * "not yet" (card #3252), bounded by the wait's own limit, which names it on timeout.
 */

import {existsSync, readFileSync} from 'node:fs';

/** A read of the user settings that met the extension's writer mid-write: the wait's "not yet", naming the text it read. */
export class PlatformNotYet extends Error {
  /** The mark the wait's runner reads to keep waiting rather than fail the row. */
  readonly notYet = true;
}

/**
 * The `remote.SSH.remotePlatform` entry of the user settings file `file`, which its absence holds as none. A text
 * that does not parse is the wait's "not yet", naming the text; any other error of the read stands.
 */
export function storedPlatformOf(file: string): unknown {
  if (!existsSync(file)) {
    return undefined;
  }
  const text = readFileSync(file, 'utf8');
  try {
    return (JSON.parse(text) as Record<string, unknown>)[
      'remote.SSH.remotePlatform'
    ];
  } catch (failure) {
    if (failure instanceof SyntaxError) {
      throw new PlatformNotYet(`the user settings do not parse: ${text}`);
    }
    throw failure;
  }
}
