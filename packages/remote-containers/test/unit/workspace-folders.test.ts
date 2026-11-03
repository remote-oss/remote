import {deepStrictEqual} from 'node:assert';
import {
  workspaceProblemOf,
  type WorkspaceRead,
} from '../../src/open/workspace-folders.ts';

const FILE = '/w/root/team.code-workspace';

/** The first problem of a workspace file whose text is `text`, with the English texts. */
function problemOf(text: string): string | undefined {
  return workspaceProblemOf({kind: 'text', text}, FILE, template => template);
}

describe('the folder list of a saved workspace (F-0404)', () => {
  it('F-0404 7.E6: a file that cannot be read gives S279 with its path and the reason', () => {
    const read: WorkspaceRead = {
      kind: 'unreadable',
      message: "EACCES: permission denied, open '/w/root/team.code-workspace'",
    };
    deepStrictEqual(
      workspaceProblemOf(read, FILE, template => template),
      "Problems loading workspace file /w/root/team.code-workspace: EACCES: permission denied, open '/w/root/team.code-workspace'",
    );
  });

  it('F-0404 7.E5: text that is not JSON with comments, no folders and an empty list give S409', () => {
    deepStrictEqual(
      ['not json at all', '{}', '{"folders": []}', '[1, 2]', ''].map(problemOf),
      Array.from({length: 5}, () => 'Workspace does not define any folders'),
    );
  });

  it('F-0404 7.E3: folders that is not an array, and an entry with neither a path nor a URI, give S406', () => {
    deepStrictEqual(
      [
        '{"folders": "sub"}',
        '{"folders": [{"name": "mystery"}]}',
        '{"folders": [7]}',
      ].map(problemOf),
      Array.from(
        {length: 3},
        () =>
          'Workspace contains a folder that defines neither a path nor a URI.',
      ),
    );
  });

  it('F-0404 7.E4: a URI that is not on the local file system gives S408 with the URI as written', () => {
    deepStrictEqual(
      problemOf('{"folders": [{"uri": "vscode-vfs://github/o/r"}]}'),
      "Workspace contains folder 'vscode-vfs://github/o/r' not on the local file system.",
    );
  });

  it('F-0404 7.E2: an absolute path gives S407 with the path as written, a Windows drive or UNC path too', () => {
    deepStrictEqual(
      [
        '{"folders": [{"path": "/abs/dir"}]}',
        '{"folders": [{"path": "C:\\\\work\\\\dir"}]}',
        '{"folders": [{"path": "\\\\\\\\server\\\\share"}]}',
      ].map(problemOf),
      [
        "Workspace contains an absolute folder path '/abs/dir'.",
        "Workspace contains an absolute folder path 'C:\\work\\dir'.",
        "Workspace contains an absolute folder path '\\\\server\\share'.",
      ],
    );
  });

  it('F-0404 7.E1: a relative path outside the shared root gives S185 with the resolved path and the root', () => {
    deepStrictEqual(
      [
        problemOf('{"folders": [{"path": "../sibling"}]}'),
        problemOf('{"folders": [{"path": "sub/../../up"}]}'),
      ],
      [
        "Folder '/w/sibling' is not a subfolder of shared root folder '/w/root'.",
        "Folder '/w/up' is not a subfolder of shared root folder '/w/root'.",
      ],
    );
  });

  it('F-0404 BR-3: a folder whose name starts with two dots is inside the root, and the parent of the root is not', () => {
    deepStrictEqual(
      [
        problemOf(
          '{"folders": [{"path": "..hidden"}, {"path": "...more/sub"}]}',
        ),
        problemOf('{"folders": [{"path": ".."}]}'),
      ],
      [
        undefined,
        "Folder '/w' is not a subfolder of shared root folder '/w/root'.",
      ],
    );
  });

  it('F-0404 BR-3: the first problem in file order wins, and a list with none gives none', () => {
    deepStrictEqual(
      [
        problemOf('{"folders": [{"path": "../out"}, {"path": "/abs"}]}'),
        problemOf(
          '// the team\n{"folders": [{"path": "."}, {"path": "sub"}, {"uri": "file:///w/root/x"},],}',
        ),
      ],
      [
        "Folder '/w/out' is not a subfolder of shared root folder '/w/root'.",
        undefined,
      ],
    );
  });
});
