/**
 * @fileoverview Which folder `devcontainer open` means the path typed, resolved against the physical
 * current folder when it is relative and normalized, kept as typed when it is absolute, less one trailing `/`. The
 * folder decides which container the window gets, so the rules are the same on both platforms; the platform's path
 * module is a parameter, so the Windows forms are checked on Linux too.
 */

import type path from 'node:path';

/** The path functions of one platform. */
export type PathFlavor = Pick<
  typeof path.posix,
  'basename' | 'dirname' | 'isAbsolute' | 'join' | 'normalize'
>;

/** A drive's root with its slash, `C:/`, whose slash is not a trailing one. */
const DRIVE_ROOT = /^[A-Za-z]:\/$/;

/** The folder `argument` names when the command runs in `current`. */
export function openPathOf(
  argument: string,
  current: string,
  flavor: PathFlavor,
): string {
  const trimmed =
    argument.length > 1 && argument.endsWith('/') && !DRIVE_ROOT.test(argument)
      ? argument.slice(0, -1)
      : argument;
  return flavor.isAbsolute(trimmed)
    ? trimmed
    : flavor.normalize(flavor.join(current, trimmed));
}
