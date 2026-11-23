import {deepStrictEqual} from 'node:assert';
import {editorFolderOf} from '../tests/acceptance/windows/editor-folder.ts';

describe('a folder as the editor names it in a container label (card #2511)', () => {
  it('#2511: a drive path gets a lower-case letter, with either slash, and any other path is unchanged', () => {
    deepStrictEqual(
      [
        editorFolderOf('C:\\Users\\RUNNER~1\\Temp\\c202-continue'),
        editorFolderOf('d:/work/run'),
        editorFolderOf('/home/runner/work/run'),
        editorFolderOf('run\\folder'),
      ],
      [
        'c:\\Users\\RUNNER~1\\Temp\\c202-continue',
        'd:/work/run',
        '/home/runner/work/run',
        'run\\folder',
      ],
    );
  });
});
