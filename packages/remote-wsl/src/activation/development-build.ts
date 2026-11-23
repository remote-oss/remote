/**
 * @fileoverview Whether the editor is a build from sources, which the extension does not start or connect in: such
 * an editor has no commit.
 */

/** True when the editor has no commit, as a build from sources has none. */
export function refusesDevelopmentBuild(
  appCommit: string | undefined,
): boolean {
  return appCommit === undefined || appCommit === '';
}
