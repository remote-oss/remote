import {deepStrictEqual} from 'node:assert';
import {
  argvPath,
  enabledProposedApiIds,
  isArgvFile,
} from '../../src/gate/argv.ts';

/** What one read lists and what it told the log. */
function read(text: string | undefined): {
  identifiers: readonly string[];
  logged: string[];
} {
  const logged: string[] = [];
  const identifiers = enabledProposedApiIds(text, message => {
    logged.push(message);
  });
  return {identifiers, logged};
}

describe('the runtime-arguments file', () => {
  it('lies in the data folder of the home folder', () => {
    deepStrictEqual(
      argvPath({
        portableFolder: undefined,
        homeFolder: '/home/user',
        dataFolderName: '.vscode-oss',
      }),
      '/home/user/.vscode-oss/argv.json',
    );
  });

  it('lies in the portable folder when the editor runs portable', () => {
    deepStrictEqual(
      argvPath({
        portableFolder: '/opt/data',
        homeFolder: '/home/user',
        dataFolderName: '.vscode-oss',
      }),
      '/opt/data/argv.json',
    );
  });

  it('ignores an empty portable folder', () => {
    deepStrictEqual(
      argvPath({
        portableFolder: '',
        homeFolder: '/home/user',
        dataFolderName: '.vscode',
      }),
      '/home/user/.vscode/argv.json',
    );
  });

  it('recognises the resolved file, and not a file of the same name elsewhere', () => {
    deepStrictEqual(
      [
        isArgvFile(
          '/home/user/.vscode/argv.json',
          '/home/user/.vscode/argv.json',
          'linux',
        ),
        isArgvFile(
          '/home/user/./.vscode/../.vscode/argv.json',
          '/home/user/.vscode/argv.json',
          'linux',
        ),
        isArgvFile(
          '/home/user/project/argv.json',
          '/home/user/.vscode/argv.json',
          'linux',
        ),
      ],
      [true, true, false],
    );
  });

  it('ignores the case of the path on win32 and darwin, and not on linux', () => {
    deepStrictEqual(
      [
        isArgvFile(
          '/Users/Me/.vscode/ARGV.json',
          '/Users/me/.vscode/argv.json',
          'win32',
        ),
        isArgvFile(
          '/Users/Me/.vscode/ARGV.json',
          '/Users/me/.vscode/argv.json',
          'darwin',
        ),
        isArgvFile(
          '/Users/Me/.vscode/ARGV.json',
          '/Users/me/.vscode/argv.json',
          'linux',
        ),
      ],
      [true, true, false],
    );
  });

  it('lists the identifiers, through a line comment and a trailing comma in an array and in an object', () => {
    deepStrictEqual(
      read(`{
        // comment
        "enable-proposed-api": ["remote-oss.remote-ssh", "x.y",],
      }`),
      {identifiers: ['remote-oss.remote-ssh', 'x.y'], logged: []},
    );
  });

  it('keeps a comma and a bracket inside a string', () => {
    deepStrictEqual(read('{"enable-proposed-api": ["a,]", "b,}"]}'), {
      identifiers: ['a,]', 'b,}'],
      logged: [],
    });
  });

  it('drops a trailing comma that a comment separates from the bracket', () => {
    deepStrictEqual(
      read('{"enable-proposed-api": ["a.b", /* x */ // y\n ]}').identifiers,
      ['a.b'],
    );
  });

  it('keeps a comma that a value follows', () => {
    deepStrictEqual(
      read('{"enable-proposed-api": ["a.b", "c.d"]}').identifiers,
      ['a.b', 'c.d'],
    );
  });

  it('keeps a comment inside a string, a URL with two slashes and an escaped quote', () => {
    deepStrictEqual(
      read(
        '{"note": "see https://example.invalid/a", "enable-proposed-api": ["a.b//c", "d\\"/*e*/"]}',
      ),
      {identifiers: ['a.b//c', 'd"/*e*/'], logged: []},
    );
  });

  it('drops a block comment that spans lines, and comments left open at the end', () => {
    deepStrictEqual(
      [
        read('{/* one\n two */"enable-proposed-api": ["a.b"]}').identifiers,
        read('{"enable-proposed-api": ["a.b"]} // end').identifiers,
        read('{"enable-proposed-api": ["a.b"]} // x\n').identifiers,
        read('{"enable-proposed-api": ["a.b"]} /* open').identifiers,
      ],
      [['a.b'], ['a.b'], ['a.b'], ['a.b']],
    );
  });

  it('reads a file that starts with a byte-order mark', () => {
    deepStrictEqual(read('\uFEFF{"enable-proposed-api": ["a.b"]}'), {
      identifiers: ['a.b'],
      logged: [],
    });
  });

  it('lists nothing and logs nothing for no file, a missing key or an empty object', () => {
    deepStrictEqual(
      [read(undefined), read('{}')],
      [
        {identifiers: [], logged: []},
        {identifiers: [], logged: []},
      ],
    );
  });

  it('lists nothing and logs once for an empty file or text that is not JSON', () => {
    const empty = read('');
    const broken = read('not json');
    deepStrictEqual(
      [
        empty.identifiers,
        empty.logged.length,
        broken.identifiers,
        broken.logged.length,
      ],
      [[], 1, [], 1],
    );
  });

  it('logs once and lists nothing for a key that is not a list', () => {
    deepStrictEqual(read('{"enable-proposed-api": "a.b"}'), {
      identifiers: [],
      logged: ["argv.json: 'enable-proposed-api' is not a list"],
    });
  });

  it('keeps the strings of a list and logs once when something else is in it', () => {
    deepStrictEqual(read('{"enable-proposed-api": ["a.b", 3, null]}'), {
      identifiers: ['a.b'],
      logged: [
        "argv.json: 'enable-proposed-api' has entries that are not text",
      ],
    });
  });

  it('lists nothing for a file that is not an object', () => {
    deepStrictEqual(
      [read('[1]').identifiers, read('null').identifiers],
      [[], []],
    );
  });
});
