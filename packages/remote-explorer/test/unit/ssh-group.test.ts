import {deepStrictEqual} from 'node:assert';
import {
  buildSshRows,
  type FolderRow,
  folderLabel,
  hostRowId,
  isWorkspacePath,
  orderedPaths,
} from '../../src/model/ssh-group.ts';

describe('the hostRow model of the SSH group', () => {
  it('F-5102.BR-7: one hostRow per alias, in the given order, with no folders', () => {
    const rows = buildSshRows(['zeta', 'Alpha', 'mid'], new Map(), undefined);
    deepStrictEqual(
      rows.map(hostRow => [hostRow.rowId, hostRow.alias, hostRow.folders]),
      [
        ['ssh-host:zeta', 'zeta', []],
        ['ssh-host:Alpha', 'Alpha', []],
        ['ssh-host:mid', 'mid', []],
      ],
    );
  });

  it('F-5102.BR-7: the row id is the alias after the prefix, and nothing else', () => {
    deepStrictEqual(hostRowId('Alpha beta'), 'ssh-host:Alpha beta');
  });

  it('F-5102.BR-7: no alias gives no hostRow, whatever the history holds', () => {
    deepStrictEqual(buildSshRows([], new Map([['x', ['/p']]]), undefined), []);
  });

  it('F-5102.BR-8: a host hostRow and a folder hostRow carry only their fields', () => {
    const [hostRow] = buildSshRows(['a'], new Map([['a', ['/p']]]), undefined);
    deepStrictEqual(
      [Object.keys(hostRow ?? {}), Object.keys(hostRow?.folders[0] ?? {})],
      [
        ['rowId', 'alias', 'folders'],
        ['kind', 'hostKey', 'path', 'label'],
      ],
    );
  });

  it('F-5104.BR-4: no setting keeps the recorded order', () => {
    deepStrictEqual(orderedPaths(['/w/b', '/w/a', '/w/c'], undefined), [
      '/w/b',
      '/w/a',
      '/w/c',
    ]);
  });

  it('F-5104.BR-4: the most recently used setting keeps the recorded order', () => {
    deepStrictEqual(
      orderedPaths(['/w/b', '/w/a', '/w/c'], 'most recently used'),
      ['/w/b', '/w/a', '/w/c'],
    );
  });

  it('F-5104.BR-5: alphabetical sorts by the characters, case-sensitive', () => {
    deepStrictEqual(
      orderedPaths(
        ['/w/zz/aaa-label', '/w/alpha', '/w/_under', '/w/bravo', '/w/Charlie'],
        'alphabetical',
      ),
      ['/w/Charlie', '/w/_under', '/w/alpha', '/w/bravo', '/w/zz/aaa-label'],
    );
  });

  it('F-5104.BR-5: alphabetical keeps every duplicate and leaves a frozen input alone', () => {
    const input = Object.freeze([
      '/srv/dup/b',
      '/srv/dup/A',
      '/srv/dup/b',
      '/srv/dup/a',
      '/srv/dup/b',
    ]);
    deepStrictEqual(
      [orderedPaths(input, 'alphabetical'), [...input]],
      [
        ['/srv/dup/A', '/srv/dup/a', '/srv/dup/b', '/srv/dup/b', '/srv/dup/b'],
        ['/srv/dup/b', '/srv/dup/A', '/srv/dup/b', '/srv/dup/a', '/srv/dup/b'],
      ],
    );
  });

  it('F-5104.BR-5: alphabetical compares Windows forms by character code', () => {
    deepStrictEqual(
      orderedPaths(
        ['c:\\x', '\\\\srv\\s', 'D:\\d', 'C:\\', 'C:/f', '/c:/u', '/C:/U'],
        'alphabetical',
      ),
      ['/C:/U', '/c:/u', 'C:/f', 'C:\\', 'D:\\d', '\\\\srv\\s', 'c:\\x'],
    );
  });

  for (const setting of [
    'Alphabetical',
    'alphabetical ',
    '',
    'alpha',
    5,
    null,
    true,
    {},
  ]) {
    it(`F-5104.BR-6: ${JSON.stringify(setting)} keeps the recorded order`, () => {
      deepStrictEqual(orderedPaths(['/b', '/a'], setting), ['/b', '/a']);
    });
  }

  for (const path of [
    '/',
    '/tmp/trailing/',
    '',
    'C:\\',
    'C:\\Users\\lab\\trail\\',
  ]) {
    it(`F-5104.BR-14: the label of ${JSON.stringify(path)} is empty`, () => {
      deepStrictEqual(folderLabel(path), '');
    });
  }

  for (const [path, label] of [
    ['~/tilde', 'tilde'],
    ['C:\\Users\\x\\proj', 'proj'],
    ['c:/Users/x/fwd', 'fwd'],
    ['/srv/ünïcødé/Ω', 'Ω'],
    ['/home/x/with space', 'with space'],
    ['\\\\srv\\share\\unc', 'unc'],
    ['plain', 'plain'],
  ] as const) {
    it(`F-5104.BR-14: the label of ${JSON.stringify(path)} is ${JSON.stringify(label)}`, () => {
      deepStrictEqual(folderLabel(path), label);
    });
  }

  for (const [path, label] of [
    ['/srv/proj.code-workspace', 'proj (Workspace)'],
    ['C:\\Users\\lab\\ws.code-workspace', 'ws (Workspace)'],
  ] as const) {
    it(`F-5104.6.3: ${JSON.stringify(path)} is a workspace labelled ${JSON.stringify(label)}`, () => {
      deepStrictEqual(
        [isWorkspacePath(path), folderLabel(path)],
        [true, label],
      );
    });
  }

  for (const [path, label] of [
    ['/w/UP.CODE-WORKSPACE', 'UP.CODE-WORKSPACE'],
    ['/w/Mixed.Code-Workspace', 'Mixed.Code-Workspace'],
    ['/w/x.code-workspace/', ''],
  ] as const) {
    it(`F-5104.BR-15: ${JSON.stringify(path)} is not a workspace`, () => {
      deepStrictEqual(
        [isWorkspacePath(path), folderLabel(path)],
        [false, label],
      );
    });
  }

  it('F-5104.BR-1: a folder hostRow, then a workspace hostRow', () => {
    const [hostRow] = buildSshRows(
      ['a'],
      new Map([['a', ['/p', '/w.code-workspace']]]),
      undefined,
    );
    const expected: FolderRow[] = [
      {kind: 'folder', hostKey: 'a', path: '/p', label: 'p'},
      {
        kind: 'workspace',
        hostKey: 'a',
        path: '/w.code-workspace',
        label: 'w (Workspace)',
      },
    ];
    deepStrictEqual(hostRow?.folders, expected);
  });

  it('F-5104.BR-3: a path recorded twice gives two identical rows', () => {
    const [hostRow] = buildSshRows(
      ['a'],
      new Map([['a', ['/p', '/p']]]),
      undefined,
    );
    deepStrictEqual(hostRow?.folders, [
      {kind: 'folder', hostKey: 'a', path: '/p', label: 'p'},
      {kind: 'folder', hostKey: 'a', path: '/p', label: 'p'},
    ]);
  });

  it('F-5104.BR-2: a history key matches an alias exactly, and other keys are dropped', () => {
    const rows = buildSshRows(
      ['Alias', 'other'],
      new Map([
        ['alias', ['/x']],
        ['gone', ['/y']],
        ['other', ['/z']],
      ]),
      undefined,
    );
    deepStrictEqual(
      rows.map(hostRow => [
        hostRow.alias,
        hostRow.folders.map(folder => folder.path),
      ]),
      [
        ['Alias', []],
        ['other', ['/z']],
      ],
    );
  });

  it('F-5104.BR-5: the rows of a host follow the sort setting', () => {
    const [hostRow] = buildSshRows(
      ['a'],
      new Map([['a', ['/b', '/a']]]),
      'alphabetical',
    );
    deepStrictEqual(
      hostRow?.folders.map(folder => folder.path),
      ['/a', '/b'],
    );
  });
});
