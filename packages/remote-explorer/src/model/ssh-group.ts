/**
 * @fileoverview The rows of the SSH group of the Remote Explorer: one row per configured host and, under it, one row
 * per recent folder or workspace. It works on plain values, so the tree and the companion's answers stay outside it.
 */

/** A recent folder or workspace of a host. */
export interface FolderRow {
  kind: 'folder' | 'workspace';
  hostKey: string;
  path: string;
  label: string;
}

/** A configured host with its recent folders. */
export interface HostRow {
  rowId: string;
  alias: string;
  folders: FolderRow[];
}

const WORKSPACE_SUFFIX = '.code-workspace';

/** The identity of a host row. */
export function hostRowId(alias: string): string {
  return `ssh-host:${alias}`;
}

/** Whether the path names a workspace file; the suffix is lower case and exact. */
export function isWorkspacePath(path: string): boolean {
  return path.endsWith(WORKSPACE_SUFFIX);
}

/** The text after the last separator; a workspace file shows its name without the suffix and `(Workspace)`. */
export function folderLabel(path: string): string {
  const name = path.slice(
    Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1,
  );
  return isWorkspacePath(name)
    ? `${name.slice(0, -WORKSPACE_SUFFIX.length)} (Workspace)`
    : name;
}

/** The paths in the order the setting asks for: only the exact `alphabetical` sorts, by character, case-sensitive. */
export function orderedPaths(
  paths: readonly string[],
  sortSetting: unknown,
): string[] {
  return sortSetting === 'alphabetical'
    ? [...paths].sort((left, right) => {
        if (left < right) {
          return -1;
        }
        return left > right ? 1 : 0;
      })
    : [...paths];
}

/** The rows of the group: one per alias in the given order, with the folders recorded under that exact alias. */
export function buildSshRows(
  aliases: readonly string[],
  history: ReadonlyMap<string, readonly string[]>,
  sortSetting: unknown,
): HostRow[] {
  return aliases.map(alias => ({
    rowId: hostRowId(alias),
    alias,
    folders: orderedPaths(history.get(alias) ?? [], sortSetting).map(path => ({
      kind: isWorkspacePath(path) ? 'workspace' : 'folder',
      hostKey: alias,
      path,
      label: folderLabel(path),
    })),
  }));
}
