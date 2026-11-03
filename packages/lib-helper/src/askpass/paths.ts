/**
 * @fileoverview Where the askpass endpoint and its launcher live: the socket as `ra-<16 hex>.sock` in the user's
 * runtime folder, or on Windows the named pipe `\\.\pipe\ra-<16 hex>`, and the launcher as `rh-askpass-<16 hex>` in
 * a folder of the runtime folder only the user can enter.
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

/** The askpass endpoint of one helper, named by 16 hex digits of a digest of its key and its askpass nonce. */
export function askpassEndpointPath(
  platform: string,
  runtimeFolder: string,
  helperKey: string,
  nonce: string,
): string {
  const name = `ra-${digestOf(helperKey, nonce)}`;
  return platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : path.posix.join(runtimeFolder, `${name}.sock`);
}

/** The launcher for a script text: 16 hex digits of its digest, so that equal launchers are one file. */
export function launcherPath(runtimeFolder: string, text: string): string {
  return path.join(
    runtimeFolder,
    LAUNCHER_FOLDER,
    `rh-askpass-${digestOf(text)}`,
  );
}
