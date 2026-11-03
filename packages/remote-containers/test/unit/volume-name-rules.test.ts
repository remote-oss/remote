import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  VOLUME_NAME_DEFAULT,
  createdAtOf,
  folderDefaultOf,
  volumeNameChecks,
  volumeNameMessageOf,
} from '../../src/volumes/volume-name-rules.ts';
import {cloneSourceOf} from '../../src/volumes/clone-source.ts';

/** A translation that marks the text it was given. */
function marked(template: string): string {
  return `«${template}»`;
}

/** The source of `input`, refusing nothing. */
function sourceOf(input: string): Parameters<typeof folderDefaultOf>[0] {
  const source = cloneSourceOf(input, 'typed');
  if ('refused' in source) {
    throw new Error(`${input}: ${source.refused}`);
  }
  return source;
}

describe('the named volume’s rules (card containers-152)', () => {
  let timeZone: string | undefined;
  before(() => {
    timeZone = process.env.TZ;
    process.env.TZ = 'UTC';
  });
  after(() => {
    if (timeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = timeZone;
    }
  });

  it('F-0702 AC-5: the default is the literal, unrelated to the repository', () => {
    strictEqual(VOLUME_NAME_DEFAULT, 'vsc-remote-containers');
  });

  it('F-0702 AC-6, BR-1: a value under two characters, empty included, is short, a single refused character still short, and the short check pre-empts the message', () => {
    deepStrictEqual(['', 'x', '!'].map(volumeNameChecks), [
      {short: true, firstCharacter: false, character: false},
      {short: true, firstCharacter: false, character: false},
      {short: true, firstCharacter: false, character: true},
    ]);
  });

  it('F-0702 AC-7, BR-2: a value of two or more characters names a bad first character, a bad character elsewhere, both, or nothing', () => {
    deepStrictEqual(
      ['-x', '_x', 'a b', 'a!', '-!', 'a-b_c.9'].map(volumeNameChecks),
      [
        {short: false, firstCharacter: true, character: false},
        {short: false, firstCharacter: true, character: false},
        {short: false, firstCharacter: false, character: true},
        {short: false, firstCharacter: false, character: true},
        {short: false, firstCharacter: true, character: true},
        {short: false, firstCharacter: false, character: false},
      ],
    );
  });

  it('F-0702 AC-6, AC-7, BR-1, BR-2: the live message is the length wording for the short values, refused character or not, and the combined character wording for the rest, none for a clean name', () => {
    deepStrictEqual(
      [
        volumeNameMessageOf('', marked),
        volumeNameMessageOf('x', marked),
        volumeNameMessageOf('!', marked),
        volumeNameMessageOf('-x', marked),
        volumeNameMessageOf('a b', marked),
        volumeNameMessageOf('-!', marked),
        volumeNameMessageOf('ab', marked),
      ],
      [
        '«Volume names should be at least two characters and the first character must be alphanumeric.»',
        '«Volume names should be at least two characters and the first character must be alphanumeric.»',
        '«Volume names should be at least two characters and the first character must be alphanumeric.»',
        '«Only [a-zA-Z0-9_.-] are allowed and the first character must be alphanumeric.»',
        '«Only [a-zA-Z0-9_.-] are allowed and the first character must be alphanumeric.»',
        '«Only [a-zA-Z0-9_.-] are allowed and the first character must be alphanumeric.»',
        undefined,
      ],
    );
  });

  it('F-0702 AC-32, AC-35: BR-15, the folder default is the repository’s own name for GitHub, and the last path segment, its .git removed, for any other URL, empty at a trailing slash', () => {
    deepStrictEqual(
      [
        'https://github.com/octocat/Hello-World',
        'https://github.com/octocat/Hello-World.git/',
        'octocat/Hello-World',
        'https://github.com/microsoft/vscode-remote-try-python/tree/clantz/test',
        'git://h/encode-f0702-alpha.git',
        'https://gitlab.com/gitlab-org/gitlab-test.git',
        'git://h/encode-f0702-alpha.git/',
        'https://gitlab.com/gitlab-org/gitlab-test.git/',
      ].map(input => folderDefaultOf(sourceOf(input))),
      [
        'Hello-World',
        'Hello-World',
        'Hello-World',
        'vscode-remote-try-python',
        'encode-f0702-alpha',
        'gitlab-test',
        '',
        '',
      ],
    );
  });

  it('F-0702 AC-4: a creation date reads as weekday, month, two-digit day and year in the process’s time zone', () => {
    strictEqual(
      createdAtOf(new Date(Date.UTC(2026, 9, 2, 12, 0, 0))),
      'Fri Oct 02 2026',
    );
  });
});
