/**
 * @fileoverview The two forms of a pre-connection script's path: the one the user sees, and the one the process is
 * started from.
 */

import path from 'node:path';

/** The configured path with a leading `~/` replaced by `home`; any other path as it is. */
export function expandedPath(configured: string, home: string): string {
  return configured.startsWith('~/')
    ? `${home}${configured.slice(1)}`
    : configured;
}

/**
 * The path the process is started from: `expanded` resolved against `workingDirectory`, so that a relative name is
 * never looked up on the search path.
 */
export function programPath(
  expanded: string,
  workingDirectory: string,
): string {
  return path.resolve(workingDirectory, expanded);
}
