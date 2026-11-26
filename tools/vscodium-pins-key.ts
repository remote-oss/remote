/**
 * @fileoverview vscodium-pins-key: the key CI caches the pinned VSCodium archives under, the editor's and the servers'
 * in the run's download cache: a digest of their pins, the releases' tags and the archives' sha256, so that a pin
 * change misses the cache and no other change does.
 *
 *   node tools/vscodium-pins-key.ts   print `key=<digest>`, for $GITHUB_OUTPUT
 */

import {createHash} from 'node:crypto';
import {VSCODIUM_RELEASE} from './acceptance.ts';
import {
  EARLIER_SERVER_ARCHIVE,
  SERVER_ARCHIVE,
} from './acceptance-downloads.ts';
import {isMainModule} from './repository.ts';

/** The pins the run's VSCodium archives are fetched and checked by: the editor's release, the servers', the earlier's. */
export const VSCODIUM_PINS: readonly unknown[] = [
  VSCODIUM_RELEASE,
  SERVER_ARCHIVE,
  EARLIER_SERVER_ARCHIVE,
];

/** The cache key of `pins`: the first 16 hex digits of the sha256 of their JSON. */
export function pinsKeyOf(pins: readonly unknown[] = VSCODIUM_PINS): string {
  return createHash('sha256')
    .update(JSON.stringify(pins))
    .digest('hex')
    .slice(0, 16);
}

if (isMainModule(import.meta.url)) {
  console.log(`key=${pinsKeyOf()}`);
}
