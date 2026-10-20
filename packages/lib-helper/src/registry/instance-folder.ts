/**
 * @fileoverview The registry folder of one editor instance: shared by every profile of the instance and by no other
 * instance, found from an extension's global storage folder.
 */

import path from 'node:path';

/** Where a helper shared by every profile of one editor instance keeps its records, or why there's no such place. */
export type InstanceFolder =
  {kind: 'resolved'; folder: string} | {kind: 'unresolved'};

/** The folder below the extension's default-profile storage that holds the instance's records. */
const INSTANCE_REGISTRY = 'instance-registry';

/**
 * A global storage folder, `<user-data>/User/globalStorage/<extension>` or
 * `<user-data>/User/profiles/<id>/globalStorage/<extension>`, in POSIX and in Windows form. The user-data part is
 * greedy, so the match reads the segments from the end.
 */
const POSIX_STORAGE =
  /^(.+)\/User\/(?:profiles\/[^/]+\/)?globalStorage\/([^/]+)$/;
const WINDOWS_STORAGE =
  /^(.+)\\User\\(?:profiles\\[^\\]+\\)?globalStorage\\([^\\]+)$/;

/** A path in Windows form: one with a drive letter or a backslash. */
function isWindowsPath(folder: string): boolean {
  return /^[A-Za-z]:|\\/.test(folder);
}

/**
 * The instance's registry folder for the extension whose global storage folder is `globalStorageFolder`:
 * `<user-data>/User/globalStorage/<extension folder>/instance-registry`, from the default profile's
 * `<user-data>/User/globalStorage/<extension folder>` or a named profile's
 * `<user-data>/User/profiles/<id>/globalStorage/<extension folder>`. A user-data folder whose own path holds a
 * `User` segment resolves too. Any other form is `unresolved`: there is no fallback to a per-user folder, which
 * would share one registry between instances.
 */
export function instanceRegistryFolder(
  globalStorageFolder: string,
): InstanceFolder {
  const windows = isWindowsPath(globalStorageFolder);
  const paths = windows ? path.win32 : path.posix;
  const storage = windows ? WINDOWS_STORAGE : POSIX_STORAGE;
  const normalized = paths.normalize(globalStorageFolder);
  return storage.test(normalized)
    ? {
        kind: 'resolved',
        folder: normalized.replace(
          storage,
          ['$1', 'User', 'globalStorage', '$2', INSTANCE_REGISTRY].join(
            paths.sep,
          ),
        ),
      }
    : {kind: 'unresolved'};
}
