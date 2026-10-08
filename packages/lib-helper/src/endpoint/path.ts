/**
 * @fileoverview Where a helper's endpoint lives: a socket file in the user's runtime folder, named by a digest so
 * that the path stays short and shows nothing of what the helper serves.
 */

import {createHash} from 'node:crypto';
import path from 'node:path';

const NAME_DIGEST_LENGTH = 16;

/**
 * The folder for endpoints: `XDG_RUNTIME_DIR` on Linux when it is set, else the temporary folder. Both belong to
 * the user on a desktop session.
 */
export function runtimeFolder(
  platform: string,
  environment: Readonly<Record<string, string | undefined>>,
  temporaryFolder: string,
): string {
  const xdgFolder = environment.XDG_RUNTIME_DIR ?? '';
  return platform === 'linux' && xdgFolder !== '' ? xdgFolder : temporaryFolder;
}

/** The endpoint of one helper: `rh-` and 16 hex digits of a digest of its namespace, key and nonce. */
export function endpointPath(
  folder: string,
  namespace: string,
  helperKey: string,
  nonce: string,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([namespace, helperKey, nonce]))
    .digest('hex');
  return path.join(folder, `rh-${digest.slice(0, NAME_DIGEST_LENGTH)}.sock`);
}
