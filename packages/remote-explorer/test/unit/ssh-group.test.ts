import {deepStrictEqual} from 'node:assert';
import {
  buildSshRows,
  type ClientPlatform,
  folderPresentation,
  folderRowId,
  hostRowId,
  isWorkspacePath,
  orderedPaths,
} from '../../src/model/ssh-group.ts';

/** The label of the recent folder `path`, which no client platform changes. */
function labelOf(path: string): string {
  return folderPresentation(path, 'devbox', 'other').label;
}

/** The description of `path` under `devbox` on a client of `platform`. */
function descriptionOf(path: string, platform: ClientPlatform): string {
  return folderPresentation(path, 'devbox', platform).description;
}

describe('the hostRow model of the SSH group', () => {
  it('F-5101.AC-27: F-5102.BR-7: one hostRow per alias, in the given order, with no folders', () => {
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

  it('F-5101.AC-10: F-5102.BR-7: the row id is the alias after the prefix, and nothing else', () => {
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
        [
          'rowId',
          'kind',
          'hostKey',
          'path',
          'label',
          'description',
          'tooltip',
          'accessibleName',
        ],
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
      deepStrictEqual(labelOf(path), '');
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
      deepStrictEqual(labelOf(path), label);
    });
  }

  for (const [path, label] of [
    ['/srv/proj.code-workspace', 'proj (Workspace)'],
    ['C:\\Users\\lab\\ws.code-workspace', 'ws (Workspace)'],
  ] as const) {
    it(`F-5104.6.3: ${JSON.stringify(path)} is a workspace labelled ${JSON.stringify(label)}`, () => {
      deepStrictEqual([isWorkspacePath(path), labelOf(path)], [true, label]);
    });
  }

  for (const [path, label] of [
    ['/w/UP.CODE-WORKSPACE', 'UP.CODE-WORKSPACE'],
    ['/w/Mixed.Code-Workspace', 'Mixed.Code-Workspace'],
    ['/w/x.code-workspace/', ''],
  ] as const) {
    it(`F-5104.BR-15: ${JSON.stringify(path)} is not a workspace`, () => {
      deepStrictEqual([isWorkspacePath(path), labelOf(path)], [false, label]);
    });
  }

  it('F-5104.BR-1: a folder hostRow, then a workspace hostRow', () => {
    const [hostRow] = buildSshRows(
      ['a'],
      new Map([['a', ['/p', '/w.code-workspace']]]),
      undefined,
    );
    deepStrictEqual(
      hostRow?.folders.map(folder => [
        folder.kind,
        folder.hostKey,
        folder.path,
        folder.label,
      ]),
      [
        ['folder', 'a', '/p', 'p'],
        ['workspace', 'a', '/w.code-workspace', 'w (Workspace)'],
      ],
    );
  });

  it('F-5104.BR-3: a path recorded twice gives two rows with the same path and different ids', () => {
    const [hostRow] = buildSshRows(
      ['a'],
      new Map([['a', ['/p', '/p']]]),
      undefined,
    );
    deepStrictEqual(
      hostRow?.folders.map(folder => [folder.path, folder.rowId]),
      [
        ['/p', 'ssh-folder:0:a'],
        ['/p', 'ssh-folder:1:a'],
      ],
    );
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

  it('F-5104.AC-41: the accessible name of a folder row is its tooltip and ", has actions"', () => {
    deepStrictEqual(folderPresentation('/w/bravo', 'devbox', 'other'), {
      label: 'bravo',
      description: '/w/bravo',
      tooltip: "'/w/bravo' on devbox",
      accessibleName: "'/w/bravo' on devbox, has actions",
    });
  });

  // BR-14's first table: the label, and the description and tooltip path on a client that is not Windows.
  for (const [path, label, description] of [
    ['/', '', '/'],
    ['/tmp/trailing/', '', '/tmp/trailing/'],
    ['', '', '/'],
    ['~/tilde', 'tilde', '/~/tilde'],
    ['C:\\Users\\x\\proj', 'proj', 'c:\\Users\\x\\proj'],
    ['c:/Users/x/fwd', 'fwd', 'c:/Users/x/fwd'],
    ['/srv/ünïcødé/Ω', 'Ω', '/srv/ünïcødé/Ω'],
    ['/home/x/with space', 'with space', '/home/x/with space'],
    [
      '/srv/proj.code-workspace',
      'proj (Workspace)',
      '/srv/proj.code-workspace',
    ],
    ['/w/UP.CODE-WORKSPACE', 'UP.CODE-WORKSPACE', '/w/UP.CODE-WORKSPACE'],
    [
      '/w/Mixed.Code-Workspace',
      'Mixed.Code-Workspace',
      '/w/Mixed.Code-Workspace',
    ],
    ['/w/.code-workspace', '.code-workspace', '/w/.code-workspace'],
    ['.code-workspace', '.code-workspace', '/.code-workspace'],
  ] as const) {
    it(`F-5104.AC-27: ${JSON.stringify(path)} shows the label ${JSON.stringify(label)}, the path ${JSON.stringify(description)} and its tooltip`, () => {
      deepStrictEqual(folderPresentation(path, 'devbox', 'other'), {
        label,
        description,
        tooltip: `'${description}' on devbox`,
        accessibleName: `'${description}' on devbox, has actions`,
      });
    });
  }

  // BR-14's second table: the Windows forms, with the path each client shows.
  for (const [path, label, onOther, onWindows] of [
    ['C:\\Users\\u\\proj', 'proj', 'c:\\Users\\u\\proj', 'c:\\Users\\u\\proj'],
    [
      'c:\\Users\\u\\lower',
      'lower',
      'c:\\Users\\u\\lower',
      'c:\\Users\\u\\lower',
    ],
    ['C:/Users/u/fwd', 'fwd', 'c:/Users/u/fwd', 'c:\\Users\\u\\fwd'],
    [
      '/C:/Users/u/uri-upper',
      'uri-upper',
      'c:/Users/u/uri-upper',
      'c:/Users/u/uri-upper',
    ],
    [
      '/c:/Users/u/uri-lower',
      'uri-lower',
      'c:/Users/u/uri-lower',
      'c:/Users/u/uri-lower',
    ],
    ['D:\\Data\\Beta', 'Beta', 'd:\\Data\\Beta', 'd:\\Data\\Beta'],
    [
      'C:\\Users\\u\\ws.code-workspace',
      'ws (Workspace)',
      'c:\\Users\\u\\ws.code-workspace',
      'c:\\Users\\u\\ws.code-workspace',
    ],
    ['C:\\', '', 'c:\\', 'c:\\'],
    [
      'C:\\Users\\u\\trail\\',
      '',
      'c:\\Users\\u\\trail\\',
      'c:\\Users\\u\\trail\\',
    ],
    ['\\\\srv\\share\\unc', 'unc', '/\\\\srv\\share\\unc', '//srv/share/unc'],
  ] as const) {
    it(`F-5104.AC-51: ${JSON.stringify(path)} shows ${JSON.stringify(label)}, and the path ${JSON.stringify(onOther)} on a Linux or macOS client and ${JSON.stringify(onWindows)} on a Windows client`, () => {
      deepStrictEqual(
        [
          labelOf(path),
          descriptionOf(path, 'other'),
          descriptionOf(path, 'windows'),
        ],
        [label, onOther, onWindows],
      );
    });
  }

  it('F-5104.AC-51: a POSIX path reads the same on a Windows client as on any other', () => {
    deepStrictEqual(
      [
        '/',
        '/tmp/trailing/',
        '/srv/ünïcødé/Ω',
        '/home/x/with space',
        '/w/bravo',
      ].map(path => [
        folderPresentation(path, 'devbox', 'windows'),
        folderPresentation(path, 'devbox', 'other'),
      ]),
      [
        '/',
        '/tmp/trailing/',
        '/srv/ünïcødé/Ω',
        '/home/x/with space',
        '/w/bravo',
      ].map(path => [
        folderPresentation(path, 'devbox', 'other'),
        folderPresentation(path, 'devbox', 'other'),
      ]),
    );
  });

  it('F-5104.AC-52: alphabetical orders the Windows forms by the recorded strings, not by the shown ones', () => {
    deepStrictEqual(
      orderedPaths(
        [
          'c:\\Users\\u\\lower',
          '\\\\srv\\share\\unc',
          'D:\\Data\\Beta',
          'C:\\Users\\u\\ws.code-workspace',
          'C:\\Users\\u\\trail\\',
          'C:\\Users\\u\\proj',
          'C:\\',
          'C:/Users/u/fwd',
          '/c:/Users/u/uri-lower',
          '/C:/Users/u/uri-upper',
        ],
        'alphabetical',
      ).map(path => labelOf(path)),
      [
        'uri-upper',
        'uri-lower',
        'fwd',
        '',
        'proj',
        '',
        'ws (Workspace)',
        'Beta',
        'unc',
        'lower',
      ],
    );
  });

  it('F-5104.AC-47: x.code-workspace is a workspace, and the upper-case and mixed-case names are folders', () => {
    deepStrictEqual(
      [
        '/w/x.code-workspace',
        '/w/UP.CODE-WORKSPACE',
        '/w/Mixed.Code-Workspace',
      ].map(path => [isWorkspacePath(path), labelOf(path)]),
      [
        [true, 'x (Workspace)'],
        [false, 'UP.CODE-WORKSPACE'],
        [false, 'Mixed.Code-Workspace'],
      ],
    );
  });

  it('F-5104.AC-53: a file named just .code-workspace is a folder row labelled .code-workspace, with its path unchanged', () => {
    const [hostRow] = buildSshRows(
      ['devbox'],
      new Map([['devbox', ['/w/.code-workspace']]]),
      undefined,
    );
    deepStrictEqual(
      hostRow?.folders.map(folder => [
        folder.kind,
        folder.label,
        folder.description,
        folder.tooltip,
      ]),
      [
        [
          'folder',
          '.code-workspace',
          '/w/.code-workspace',
          "'/w/.code-workspace' on devbox",
        ],
      ],
    );
  });

  it('F-5104.AC-27: sixty entries under one host are all listed', () => {
    const paths = Array.from(
      {length: 60},
      (ignored, index) => `/w/p${String(index)}`,
    );
    const [hostRow] = buildSshRows(
      ['devbox'],
      new Map([['devbox', paths]]),
      undefined,
    );
    deepStrictEqual(
      hostRow?.folders.map(folder => folder.path),
      paths,
    );
  });

  it('F-5104.BR-3: every row id is unique, across positions, aliases and repeated paths', () => {
    const rows = buildSshRows(
      ['a', 'b'],
      new Map([
        ['a', ['/p', '/p', '/q']],
        ['b', ['/p', '/q']],
      ]),
      undefined,
    );
    const rowIds = rows.flatMap(hostRow => [
      hostRow.rowId,
      ...hostRow.folders.map(folder => folder.rowId),
    ]);
    deepStrictEqual(
      [
        new Set(rowIds).size === rowIds.length,
        folderRowId('a', 0) === folderRowId('b', 0),
      ],
      [true, false],
    );
  });

  it('F-5104.BR-14: the client platform reaches the rows of the group', () => {
    const [hostRow] = buildSshRows(
      ['devbox'],
      new Map([['devbox', ['C:/Users/u/fwd']]]),
      undefined,
      'windows',
    );
    deepStrictEqual(
      hostRow?.folders.map(folder => folder.description),
      ['c:\\Users\\u\\fwd'],
    );
  });
});
