/**
 * @fileoverview The options of the folder dialog that Open Folder in Container shows.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The text of the dialog's confirm button, which core words "Open" and no table of ours holds. */
const FOLDER_DIALOG_TEMPLATES = {
  folderDialogOpen: 'Open',
} as const;

/** The options of the dialog that picks one folder, its confirm button reading Open in the user's language. */
export function folderDialogOptions(translate: Translate): {
  canSelectFiles: false;
  canSelectFolders: true;
  canSelectMany: false;
  openLabel: string;
} {
  return {
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: translate(FOLDER_DIALOG_TEMPLATES.folderDialogOpen),
  };
}
