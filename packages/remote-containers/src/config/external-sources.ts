/**
 * @fileoverview When the sources outside a folder (the store of user data and the repository configuration folders) are
 * consulted for a window: a window of more than one folder, a multi-root workspace, looks nowhere outside its folders
 * (F-0302 BR-12).
 */

/** Whether a window that declares `folderCount` folders consults the sources outside them. */
export function externalSourcesApply(folderCount: number): boolean {
  return folderCount <= 1;
}
