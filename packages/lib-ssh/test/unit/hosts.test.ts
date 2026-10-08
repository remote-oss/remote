import {deepStrictEqual, match, strictEqual} from 'node:assert';
import {listHosts} from '../../src/config/hosts.ts';
import type {
  ClientLocations,
  ConfigFileReader,
  HostEntry,
} from '../../src/index.ts';
import {memoryReader} from './memory-reader.fixture.ts';

const USER_FILE = '/home/dev/.ssh/config';
const SYSTEM_FILE = '/etc/ssh/ssh_config';
const LINUX: ClientLocations = {homeFolder: '/home/dev', platform: 'linux'};
const WINS: ClientLocations = {
  homeFolder: 'C:\\Users\\dev',
  platform: 'windows',
  programDataFolder: 'C:\\ProgramData',
} as const;

/** The files of one tree: the user file's text, or nothing, plus the given extras. */
function tree(
  userText: string | undefined,
  extras: Array<[string, string | undefined]> = [],
): ConfigFileReader {
  const texts = new Map<string, string>();
  if (userText !== undefined) {
    texts.set(USER_FILE, userText);
  }
  for (const [file, text] of extras) {
    if (text !== undefined) {
      texts.set(file, text);
    }
  }
  return memoryReader(texts);
}

/** The host entries of one tree; a parse error of a file in effect fails the call. */
function entries(
  userText: string | undefined,
  extras: Array<[string, string | undefined]> = [],
  options: {configFile?: string; locations?: ClientLocations} = {},
): HostEntry[] {
  const result = listHosts(
    options.configFile ?? '',
    options.locations ?? LINUX,
    tree(userText, extras),
  );
  if ('parseError' in result) {
    throw new Error(`${result.parseError.file}: ${result.parseError.reason}`);
  }
  return result.hosts;
}

/** The entries read through one reader, so a later mutation of the map is seen. */
function readHosts(reader: ConfigFileReader): HostEntry[] {
  const result = listHosts('', LINUX, reader);
  if ('parseError' in result) {
    throw new Error(`${result.parseError.file}: ${result.parseError.reason}`);
  }
  return result.hosts;
}

function names(
  userText: string | undefined,
  extras?: Array<[string, string | undefined]>,
  options?: {configFile?: string; locations?: ClientLocations},
): string[] {
  return entries(userText, extras, options).map(entry => entry.name);
}

/** The file and reason of a tree's parse error, or the empty text when it lists. */
function errorOf(
  userText: string | undefined,
  extras: Array<[string, string | undefined]> = [],
  options: {configFile?: string; locations?: ClientLocations} = {},
): string {
  const result = listHosts(
    options.configFile ?? '',
    options.locations ?? LINUX,
    tree(userText, extras),
  );
  return 'parseError' in result
    ? `${result.parseError.file}: ${result.parseError.reason}`
    : '';
}

/** The names of the large file, in file order. */
function largeFileText(): string {
  const lines: string[] = [];
  for (let index = 0; index < 2000; index++) {
    lines.push(`Host a-${String(index)} b-${String(index)}`);
  }
  for (let index = 0; index < 200; index++) {
    lines.push(`Match host m-${String(index)}`);
  }
  return lines.join('\n');
}

describe('listHosts (the host entries of the files in effect)', () => {
  it('F-2202.AC-1: every name of a Host line, in order', () => {
    deepStrictEqual(names('Host one\nHost two three   four\nHost last'), [
      'one',
      'two',
      'three',
      'four',
      'last',
    ]);
  });

  it('F-2202.AC-2: patterns are not hosts', () => {
    deepStrictEqual(
      names(
        'Host *\nHost *.corp\nHost web-?\nHost !neg\nHost alpha *.beta !gamma delta',
      ),
      ['alpha', 'delta'],
    );
  });

  it('F-2202.AC-3: keywords in any case and words in any form', () => {
    deepStrictEqual(
      names(
        'HOST upperkw\nhost lowerkw\nHost=eqsyntax\nHost tabbed\ttabbed2\n' +
          'Host "quoted name" afterquote\nHost trailing # a comment',
      ),
      [
        'upperkw',
        'lowerkw',
        'eqsyntax',
        'tabbed',
        'tabbed2',
        'quoted name',
        'afterquote',
        'trailing',
      ],
    );
  });

  it('F-2202.AC-34: names from Host and Match lines', () => {
    deepStrictEqual(
      names(
        'Host = eqspace\nHost =eqleft\nHost= eqright\nMatch canonical\nMatch final\n' +
          'Match canonical all\nMatch host ok,!bad\nMatch host "sp ace"\n' +
          'Match host plainok\nHost after',
      ),
      ['eqspace', 'eqleft', 'eqright', 'ok,!bad', 'sp ace', 'plainok', 'after'],
    );
  });

  it('F-2202.AC-4: a name as written, however odd', () => {
    const longName = 'n'.repeat(300);
    deepStrictEqual(
      names(
        `Host comma1,comma2\nHost user@at\nHost [::1]\nHost ${
          longName
        }\nHost \u00fcn\u00ef-c\u00f6d\u00e9`,
      ),
      [
        'comma1,comma2',
        'user@at',
        '[::1]',
        longName,
        '\u00fcn\u00ef-c\u00f6d\u00e9',
      ],
    );
  });

  it('F-2202.AC-5: each name once, the case as written', () => {
    deepStrictEqual(
      names('Host dup\nHost dup\nHost same same\nHost Foo\nHost foo\nHost FOO'),
      ['dup', 'same', 'Foo', 'foo', 'FOO'],
    );
  });

  it('F-2202.AC-6: the value of the last host criterion of a Match', () => {
    deepStrictEqual(
      names(
        'Match host m1,m2\nMatch host "m3,m4" user bob\n' +
          'Match exec "false" host execfalse\nMATCH HOST m14\n' +
          'Match host qq user u host second',
      ),
      ['m1,m2', 'm3,m4', 'execfalse', 'm14', 'second'],
    );
  });

  it('F-2202.AC-7: no concrete name holds', () => {
    deepStrictEqual(
      names(
        'Match host *.wild\nMatch host !negm\nMatch host ok1,*.wild2\n' +
          'Match originalhost om1\nMatch !host m12\nMatch all\nMatch tagged t1',
      ),
      [],
    );
  });

  it('F-2202.BR-5: a value that names nothing', () => {
    deepStrictEqual(names('Match host m5 !m6 *.m7'), ['m5']);
  });

  it('F-2202.BR-6: bare criteria keep their block open to host values', () => {
    deepStrictEqual(
      names(
        'Match canonical host m10\nMatch final host m11\n' +
          'Match tagged t1 host m9\nHost after',
      ),
      ['m10', 'm11', 'm9', 'after'],
    );
  });

  it('F-2202.BR-6: a Match without a host value', () => {
    deepStrictEqual(
      names('Match user bob\nMatch exec "true"\nMatch all\nHost after'),
      ['after'],
    );
  });

  it('F-2202.AC-8: Tag criteria match nothing here', () => {
    deepStrictEqual(names('Host h1\n  Tag t1\nMatch tagged t1\nHost h2'), [
      'h1',
      'h2',
    ]);
  });

  it('F-2202.BR-8: a Match host value lists, and a Host line after it does too', () => {
    deepStrictEqual(names('Match host m1\nHost h2'), ['m1', 'h2']);
  });

  it('F-2202.7.E4: a Host line without a pattern', () => {
    deepStrictEqual(names('Host\nHost b'), ['b']);
  });

  it('F-2201.AC-37: a bare keyword line names nothing', () => {
    deepStrictEqual(names('Port\nHost b'), []);
  });

  const AC9_BLOCKS = [
    '',
    'Host *\n',
    'Host a *\n',
    'Host "*"\n',
    'Host * !x\n',
  ] as const;
  for (const block of AC9_BLOCKS) {
    it(`F-2202.AC-9: an Include after ${
      block === '' ? 'the top' : block.replace('\n', '')
    } applies`, () => {
      const list = names(`${block}Include inc.conf`, [
        ['/home/dev/.ssh/inc.conf', 'Host inc'],
      ]);
      strictEqual(list.includes('inc'), true);
    });
  }

  const AC10_BLOCKS = [
    'Host a\n',
    'Host a*\n',
    'Host *.corp\n',
    'Host !x\n',
    'Match all\n',
    'Match host *\n',
    'Match exec "true"\n',
  ] as const;
  for (const block of AC10_BLOCKS) {
    it(`F-2202.AC-10: an Include after ${block.replace(
      '\n',
      '',
    )} does not apply`, () => {
      const list = names(`${block}Include inc.conf`, [
        ['/home/dev/.ssh/inc.conf', 'Host inc'],
      ]);
      strictEqual(list.includes('inc'), false);
    });
  }

  it('F-2202.BR-9: the last Host line before an Include decides', () => {
    const list = names('Host *\nHost a\nInclude inc.conf', [
      ['/home/dev/.ssh/inc.conf', 'Host inc'],
    ]);
    strictEqual(list.includes('inc'), false);
  });

  it('F-2202.AC-11: a glob include reads its matches, highest code point first', () => {
    deepStrictEqual(
      names('Include conf.d/*.conf', [
        ['/home/dev/.ssh/conf.d/a.conf', 'Host a.conf'],
        ['/home/dev/.ssh/conf.d/b.conf', 'Host b.conf'],
        ['/home/dev/.ssh/conf.d/10.conf', 'Host 10.conf'],
        ['/home/dev/.ssh/conf.d/z.txt', 'Host z.txt'],
      ]),
      ['b.conf', 'a.conf', '10.conf'],
    );
  });

  it('F-2202.BR-12: a glob of an include, hidden names excluded', () => {
    deepStrictEqual(
      names('Include conf.d/*.conf', [
        ['/home/dev/.ssh/conf.d/Z.conf', 'Host Z.conf'],
        ['/home/dev/.ssh/conf.d/c1.conf', 'Host c1.conf'],
        ['/home/dev/.ssh/conf.d/c2.conf', 'Host c2.conf'],
        ['/home/dev/.ssh/conf.d/c3.conf', 'Host c3.conf'],
        ['/home/dev/.ssh/conf.d/m.conf', 'Host m.conf'],
      ]),
      ['m.conf', 'c3.conf', 'c2.conf', 'c1.conf', 'Z.conf'],
    );
  });

  it('F-2202.AC-12: includes after the file own hosts, level by level', () => {
    deepStrictEqual(
      names('Include tree/a.conf\nInclude tree/b.conf\nHost own', [
        ['/home/dev/.ssh/tree/a.conf', 'Include tree/a2.conf\nHost tree-a'],
        ['/home/dev/.ssh/tree/a2.conf', 'Include tree/a3.conf\nHost tree-a2'],
        ['/home/dev/.ssh/tree/a3.conf', 'Host tree-a3'],
        ['/home/dev/.ssh/tree/b.conf', 'Include tree/b2.conf\nHost tree-b'],
        ['/home/dev/.ssh/tree/b2.conf', 'Host tree-b2'],
      ]),
      ['own', 'tree-a', 'tree-b', 'tree-a2', 'tree-b2', 'tree-a3'],
    );
  });

  it('F-2202.BR-14 (provisional): nested includes have no depth limit', () => {
    deepStrictEqual(
      names('Include a.conf', [
        ['/home/dev/.ssh/a.conf', 'Include b.conf\nHost a'],
        ['/home/dev/.ssh/b.conf', 'Include c.conf\nHost b'],
        ['/home/dev/.ssh/c.conf', 'Include d.conf\nHost c'],
        ['/home/dev/.ssh/d.conf', 'Host d'],
      ]),
      ['a', 'b', 'c', 'd'],
    );
  });

  it('F-2202.BR-12 (provisional): a bracket class of an include glob', () => {
    deepStrictEqual(
      names('Include conf.d/[a-b]*', [
        ['/home/dev/.ssh/conf.d/a1', 'Host a1'],
        ['/home/dev/.ssh/conf.d/b1', 'Host b1'],
        ['/home/dev/.ssh/conf.d/c1', 'Host c1'],
      ]),
      ['b1', 'a1'],
    );
  });

  const AC13_INCLUDES = [
    ['Include rel.conf', '/home/dev/.ssh/rel.conf', 'relhost'],
    ['Include ../up.conf', '/home/dev/up.conf', 'uphost'],
    ['Include ~/abs.conf', '/home/dev/abs.conf', 'abshost'],
    ['Include /opt/abs.conf', '/opt/abs.conf', 'optabs'],
    ['Include "q.conf"', '/home/dev/.ssh/q.conf', 'qhost'],
    ['include low.conf', '/home/dev/.ssh/low.conf', 'lowhost'],
    ['Include=eq.conf', '/home/dev/.ssh/eq.conf', 'eqhost'],
  ] as const;
  for (const [line, file, host] of AC13_INCLUDES) {
    it(`F-2202.AC-13: an Include of ${line}`, () => {
      deepStrictEqual(names(line, [[file, `Host ${host}`]]), [host]);
    });
  }

  it('F-2202.AC-14: an Include of two paths', () => {
    deepStrictEqual(
      names('Include a.conf b.conf', [
        ['/home/dev/.ssh/a.conf', 'Host ahost'],
        ['/home/dev/.ssh/b.conf', 'Host bhost'],
      ]),
      [],
    );
  });

  it('F-2202.AC-14: an Include with a ${} form', () => {
    deepStrictEqual(
      names('Include ${HOME}/x.conf', [
        ['/home/dev/.ssh/x.conf', 'Host xhost'],
      ]),
      [],
    );
  });

  it('F-2202.AC-14: an Include with a %d form', () => {
    deepStrictEqual(
      names('Include %d/x.conf', [['/home/dev/.ssh/x.conf', 'Host xhost']]),
      [],
    );
  });

  it('F-2202.AC-15: an Include of a missing file', () => {
    deepStrictEqual(names('Include missing.conf\nHost own'), ['own']);
  });

  it('F-2202.AC-15: an Include of a folder', () => {
    deepStrictEqual(
      names('Include conf.d\nHost own', [
        ['/home/dev/.ssh/conf.d/a.conf', 'Host ahost'],
      ]),
      ['own'],
    );
  });

  it('F-2202.AC-15: an Include the port cannot read', () => {
    deepStrictEqual(
      names('Include cant.conf\nHost own', [
        ['/home/dev/.ssh/cant.conf', undefined],
      ]),
      ['own'],
    );
  });

  it('F-2202.AC-15: an Include of the file itself', () => {
    deepStrictEqual(names('Include config\nHost own'), ['own']);
  });

  it('F-2201.AC-38: a loop of includes ends where a file is seen', () => {
    deepStrictEqual(
      names('Include b.conf\nHost a', [
        ['/home/dev/.ssh/b.conf', 'Include config\nHost b'],
      ]),
      ['a', 'b'],
    );
  });

  it('F-2202.AC-16: a relative Include resolves against the configured file', () => {
    deepStrictEqual(
      names(
        undefined,
        [
          ['/home/dev/custom/config', 'Include sub/inc.conf'],
          ['/home/dev/custom/sub/inc.conf', 'Host near'],
          ['/home/dev/.ssh/sub/inc.conf', 'Host far'],
          [SYSTEM_FILE, 'Host sysonly'],
        ],
        {configFile: '/home/dev/custom/config'},
      ),
      ['near'],
    );
  });

  it('F-2202.AC-17: the user and the system file each list, repeats between them kept', () => {
    deepStrictEqual(
      entries('Host both', [[SYSTEM_FILE, 'Host both\nHost sysonly']]),
      [
        {name: 'both', file: USER_FILE},
        {name: 'both', file: SYSTEM_FILE},
        {name: 'sysonly', file: SYSTEM_FILE},
      ],
    );
  });

  it('F-2201.BR-1: the system file and its glob includes', () => {
    deepStrictEqual(
      names(undefined, [
        [SYSTEM_FILE, 'Include ssh_config.d/*.conf'],
        ['/etc/ssh/ssh_config.d/x.conf', 'Host sysx'],
      ]),
      ['sysx'],
    );
  });

  it('F-2201.BR-1: a Windows client reads its user file and its system file', () => {
    deepStrictEqual(
      names(
        undefined,
        [
          ['C:\\Users\\dev\\.ssh\\config', 'Host winuser'],
          ['C:\\ProgramData\\ssh\\ssh_config', 'Host winsys'],
        ],
        {locations: WINS},
      ),
      ['winuser', 'winsys'],
    );
  });

  const AC18_FORMS = [
    ['CRLF line ends', 'Host one\r\nHost two\r\nHost last'],
    ['a leading byte order mark', '\uFEFFHost one\nHost two\nHost last'],
    ['LF line ends', 'Host one\nHost two\nHost last'],
  ] as const;
  for (const [form, text] of AC18_FORMS) {
    it(`F-2202.AC-18: ${form} read the same hosts`, () => {
      deepStrictEqual(names(text), ['one', 'two', 'last']);
    });
  }

  it('F-2202.BR-19: a large file lists every name in file order', () => {
    const expected: string[] = [];
    for (let index = 0; index < 2000; index++) {
      expected.push(`a-${String(index)}`, `b-${String(index)}`);
    }
    for (let index = 0; index < 200; index++) {
      expected.push(`m-${String(index)}`);
    }
    deepStrictEqual(names(largeFileText()), expected);
  });

  it('F-2202.AC-19: a repeat of the call stays under a second', () => {
    const reader = tree(largeFileText());
    const before = performance.now();
    listHosts('', LINUX, reader);
    listHosts('', LINUX, tree('Host x\nHost y'));
    strictEqual(performance.now() - before < 1000, true);
  });

  it('F-2202.BR-20: a call reads the files again', () => {
    const texts = new Map<string, string>([[USER_FILE, 'Host one']]);
    const reader = memoryReader(texts);
    const first = readHosts(reader).map(entry => entry.name);
    texts.set(USER_FILE, 'Host changed');
    const second = readHosts(reader).map(entry => entry.name);
    deepStrictEqual([first, second], [['one'], ['changed']]);
  });

  it('F-2201.BR-8: an unparseable user file stops the list', () => {
    match(
      errorOf('Host "abc', [[SYSTEM_FILE, 'Host sysonly']]),
      new RegExp(`^${USER_FILE}: .+$`),
    );
  });

  it('F-2201.AC-24: an unparseable included file is skipped', () => {
    deepStrictEqual(
      names('Include bad.conf\nHost own', [
        ['/home/dev/.ssh/bad.conf', 'Host "abc'],
      ]),
      ['own'],
    );
  });

  it('F-2201.BR-7: a missing user file', () => {
    deepStrictEqual(names(undefined, [[SYSTEM_FILE, 'Host sysonly']]), [
      'sysonly',
    ]);
  });

  it('F-2201.AC-42: an unreadable user file', () => {
    deepStrictEqual(
      names(undefined, [
        [USER_FILE, undefined],
        [SYSTEM_FILE, 'Host sysonly'],
      ]),
      ['sysonly'],
    );
  });

  it('F-2201.AC-33: only patterns', () => {
    deepStrictEqual(names('Host *\nHost *.corp !x'), []);
  });

  it('F-2201.AC-8: a configured file alone', () => {
    deepStrictEqual(
      names(
        undefined,
        [
          ['/srv/c', 'Host custom'],
          [USER_FILE, 'Host userhost'],
        ],
        {configFile: '/srv/c'},
      ),
      ['custom'],
    );
  });

  it('F-2201.AC-12: a configured ~ path expands', () => {
    deepStrictEqual(
      names(undefined, [['/home/dev/alt', 'Host viaalt']], {
        configFile: '~/alt',
      }),
      ['viaalt'],
    );
  });

  const AC13_FALLBACKS = ['rel/config', '~', '${HOME}/x', '   '] as const;
  for (const setting of AC13_FALLBACKS) {
    it(`F-2201.AC-13: a configured ${setting} holds its own`, () => {
      deepStrictEqual(
        names(undefined, [[SYSTEM_FILE, 'Host y']], {configFile: setting}),
        [],
      );
    });
  }

  it('F-2201.BR-8: an unparseable system file stops the list', () => {
    match(
      errorOf('Host own', [[SYSTEM_FILE, 'Host "abc']]),
      new RegExp(`^${SYSTEM_FILE}: .+$`),
    );
  });

  it('F-2201.BR-8: an unparseable included system file is skipped', () => {
    deepStrictEqual(
      names('Host own', [
        [SYSTEM_FILE, 'Include ssh_config.d/*.conf\nHost sys'],
        ['/etc/ssh/ssh_config.d/x.conf', 'Host "abc'],
      ]),
      ['own', 'sys'],
    );
  });

  it('F-2201.AC-38: the bytes before the first line hold no hosts', () => {
    deepStrictEqual(names('\u0000\u0001\u0002\nHost bin'), []);
  });

  it('F-2201.Q1 (provisional): an unterminated quote names no hosts', () => {
    match(errorOf('Host "abc'), new RegExp(`^${USER_FILE}: .+$`));
  });

  it('F-2202.BR-1 (provisional): a # inside a quoted word is part of the word', () => {
    deepStrictEqual(names('Host "a#b"\nHost c#d'), ['a#b', 'c']);
  });

  it('F-2202.BR-12 (provisional): a glob without wildcards, hidden names excluded', () => {
    deepStrictEqual(
      names('Include conf.d/*', [
        ['/home/dev/.ssh/conf.d/.hidden', 'Host .hidden'],
        ['/home/dev/.ssh/conf.d/shown', 'Host shown'],
      ]),
      ['shown'],
    );
  });

  it('F-2202.Q2 (lead 2026-10-07): Windows home forms of an Include', () => {
    deepStrictEqual(
      names(
        undefined,
        [
          [
            'C:\\Users\\dev\\.ssh\\config',
            'Include inc.conf\nInclude ~\\other.conf\nInclude ~/third.conf',
          ],
          ['C:\\Users\\dev\\.ssh\\inc.conf', 'Host inc'],
          ['C:\\Users\\dev\\other.conf', 'Host other'],
          ['C:\\Users\\dev\\third.conf', 'Host third'],
        ],
        {locations: WINS},
      ),
      ['inc', 'other', 'third'],
    );
  });
});
