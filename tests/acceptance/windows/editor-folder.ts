/**
 * @fileoverview A folder as the editor names it, which is how the dev container CLI labels a folder's container. It
 * imports nothing from the harness or the editor, so that the tools project can test it.
 */

/**
 * `folder` as the editor names it: on Windows a URI's fsPath gives a drive path's letter in lower case, so the label
 * `devcontainer.local_folder` holds `c:\…` for the folder `C:\…`. Any other path is unchanged.
 */
export function editorFolderOf(folder: string): string {
  return /^[A-Za-z]:[\\/]/.test(folder)
    ? `${folder.charAt(0).toLowerCase()}${folder.slice(1)}`
    : folder;
}
