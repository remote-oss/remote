/**
 * @fileoverview Where the askpass endpoint and its launcher live in the user's runtime folder: the socket as
 * `ra-<16 hex>.sock`, the launcher as `rh-askpass-<16 hex>` in a folder only the user can enter.
 */

import {createHash} from 'node:crypto';
import path from 'node:path';

const NAME_DIGEST_LENGTH = 16;

/** The folder of the runtime folder that holds launchers and nothing else. */
export const LAUNCHER_FOLDER = 'rh-askpass';

function digestOf(...parts: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, NAME_DIGEST_LENGTH);
}

/** The askpass endpoint of one helper: 16 hex digits of a digest of its key and its askpass nonce. */
export function askpassEndpointPath(
  runtimeFolder: string,
  helperKey: string,
  nonce: string,
): string {
  return path.join(runtimeFolder, `ra-${digestOf(helperKey, nonce)}.sock`);
}

/** The launcher for a script text: 16 hex digits of its digest, so that equal launchers are one file. */
export function launcherPath(runtimeFolder: string, text: string): string {
  return path.join(
    runtimeFolder,
    LAUNCHER_FOLDER,
    `rh-askpass-${digestOf(text)}`,
  );
}
