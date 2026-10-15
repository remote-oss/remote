/**
 * @fileoverview The values of the two mount settings, from the user's (global) settings: the consistency of the
 * workspace mount and whether the Git worktree's common dir is mounted. Both keys have application scope, so only the
 * user's value counts.
 */

/** The consistency when neither key is set. */
const DEFAULT_CONSISTENCY = 'cached';

/**
 * The user's `dev.containers.workspaceMountConsistency` when it's a string, else the deprecated
 * `remote.containers.workspaceMountConsistency` when that's a string, else `cached`. A string outside the enum
 * goes as written, for the CLI to refuse.
 */
export function workspaceMountConsistencyOf(
  current: unknown,
  legacy: unknown,
): string {
  if (typeof current === 'string') {
    return current;
  }
  return typeof legacy === 'string' ? legacy : DEFAULT_CONSISTENCY;
}

/** True for the boolean `true` and for the string `"true"` written by hand; false for anything else. */
export function mountGitWorktreeCommonDirOf(value: unknown): boolean {
  return value === true || value === 'true';
}
