/**
 * @fileoverview The key a launch's per-window files are named by. A window name of at most 200 bytes is its own key; a
 * longer one is a key of at most 197 bytes, so that a window opened on a 300-character folder still gets files the
 * launch's filesystem can hold.
 */

import {createHash} from 'node:crypto';

/** The longest leading part of `name` of at most `bytes` bytes, ending on a character boundary. */
function prefixOf(name: string, bytes: number): string {
  let prefix = '';
  let size = 0;
  for (const character of name) {
    const width = Buffer.byteLength(character, 'utf8');
    if (size + width > bytes) {
      break;
    }
    prefix += character;
    size += width;
  }
  return prefix;
}

/** The key a launch's per-window files for the window named `name` are named by. */
export function windowFileKey(name: string): string {
  if (Buffer.byteLength(name, 'utf8') <= 200) {
    return name;
  }
  const hash = createHash('sha256')
    .update(name, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `${prefixOf(name, 180)}~${hash}`;
}
