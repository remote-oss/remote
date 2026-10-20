/**
 * @fileoverview The rows of the SSH group of the Remote Explorer: one row per configured host and, under it, one row
 * per recent folder or workspace. It works on plain values, so the tree and the companion's answers stay outside it.
 */

/** The client's platform as the rows tell it apart: the Windows forms of a path read differently on a Windows client. */
export type ClientPlatform = 'windows' | 'other';

/** What a recent folder's row shows. */
interface FolderPresentation {
  label: string;
  /** The path as the row shows it, which is also the path of the tooltip. */
  description: string;
  tooltip: string;
  accessibleName: string;
}

/** A recent folder or workspace of a host. */
export interface FolderRow extends FolderPresentation {
  /** Unique among all rows: built from the host and the position, never from the path alone. */
  rowId: string;
  kind: 'folder' | 'workspace';
  hostKey: string;
  path: string;
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

/** The identity of the folder row at `position` under `alias`. */
export function folderRowId(alias: string, position: number): string {
  return `ssh-folder:${String(position)}:${alias}`;
}

/** The text after the last separator, forward or back. */
function baseName(path: string): string {
  return path.slice(
    Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1,
  );
}

/**
 * Whether the path names a workspace file: its base name ends in the lower-case `.code-workspace` and has a character
 * before it, so a file whose whole name is `.code-workspace` is a folder, as core's own test for a workspace file reads it.
 */
export function isWorkspacePath(path: string): boolean {
  const name = baseName(path);
  return (
    name.length > WORKSPACE_SUFFIX.length && name.endsWith(WORKSPACE_SUFFIX)
  );
}

/** A Windows drive path, with a leading slash when it is a URI path, whose drive letter is followed by a separator or nothing. */
const DRIVE_PATH = /^(\/?)([A-Za-z]):(?=[\\/]|$)(.*)$/s;

/**
 * The path as the row shows it. A drive letter is lower case. A URI-form drive path loses its leading slash and keeps its
 * forward slashes. A drive path with forward slashes turns them into backslashes on a Windows client only. A UNC path
 * gets a leading slash and keeps its backslashes, or on a Windows client turns them into forward slashes. Any other path
 * is shown as recorded, with a leading slash added when it has none.
 */
function shownPath(path: string, platform: ClientPlatform): string {
  if (path.startsWith('\\\\')) {
    return platform === 'windows' ? path.replaceAll('\\', '/') : `/${path}`;
  }
  const drive = DRIVE_PATH.exec(path);
  if (drive === null) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  const [, slash = '', letter = '', rest = ''] = drive;
  const lowered = `${letter.toLowerCase()}:`;
  return slash === '' && platform === 'windows'
    ? `${lowered}${rest.replaceAll('/', '\\')}`
    : `${lowered}${rest}`;
}

/** The label, description, tooltip and accessible name of the recent folder `path` of host `alias`. */
export function folderPresentation(
  path: string,
  alias: string,
  platform: ClientPlatform,
): FolderPresentation {
  const name = baseName(path);
  const description = shownPath(path, platform);
  const tooltip = `'${description}' on ${alias}`;
  return {
    label: isWorkspacePath(path)
      ? `${name.slice(0, -WORKSPACE_SUFFIX.length)} (Workspace)`
      : name,
    description,
    tooltip,
    accessibleName: `${tooltip}, has actions`,
  };
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
  platform: ClientPlatform = 'other',
): HostRow[] {
  return aliases.map(alias => ({
    rowId: hostRowId(alias),
    alias,
    folders: orderedPaths(history.get(alias) ?? [], sortSetting).map(
      (path, position) => ({
        rowId: folderRowId(alias, position),
        kind: isWorkspacePath(path) ? 'workspace' : 'folder',
        hostKey: alias,
        path,
        ...folderPresentation(path, alias, platform),
      }),
    ),
  }));
}
