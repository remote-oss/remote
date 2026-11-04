/**
 * @fileoverview When the sources outside a folder (the store of user data and the repository configuration folders) are
 * consulted for a window: a window of more than one folder, a multi-root workspace, looks nowhere outside its folders.
 */

/** Whether a window that declares `folderCount` folders consults the sources outside them. */
export function externalSourcesApply(folderCount: number): boolean {
  return folderCount <= 1;
}
