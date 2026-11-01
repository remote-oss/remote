import {deepStrictEqual} from 'node:assert';
import {folderDialogOptions} from '../../src/open/folder-dialog.ts';

describe('folderDialogOptions', () => {
  it('F-0403 AC-2: the dialog picks one folder and its confirm button reads the translated Open', () => {
    deepStrictEqual(
      folderDialogOptions(text => `<${text}>`),
      {
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '<Open>',
      },
    );
  });
});
