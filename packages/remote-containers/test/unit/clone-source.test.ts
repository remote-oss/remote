import {deepStrictEqual} from 'node:assert';
import {cloneSourceOf} from '../../src/volumes/clone-source.ts';
import {lsRemoteArguments} from '../../src/volumes/git-arguments.ts';
import {uniqueVolumeName} from '../../src/volumes/volume-name.ts';

/** The source `input` gives from `origin`, which a row expects to be accepted. */
function accepted(input: string, origin: 'typed' | 'link' = 'typed') {
  const source = cloneSourceOf(input, origin);
  if ('refused' in source) {
    throw new Error(`${input} was refused: ${source.refused}`);
  }
  return source;
}

describe('the repository a clone takes (card containers-151)', () => {
  it('F-0701 BR-15: whitespace around the input is removed first, and nothing else is normalized', () => {
    deepStrictEqual(accepted('  https://h.invalid/r.git#x  '), {
      repositoryPath: 'https://h.invalid/r.git#x',
      urlToClone: 'https://h.invalid/r.git#x',
      repositoryName: 'r.git#x',
    });
  });

  it('F-0701 BR-7: owner/repo becomes its GitHub URL; three segments or a host without a scheme stay as typed', () => {
    deepStrictEqual(
      [
        accepted('microsoft/vscode-remote-try-node').repositoryPath,
        accepted('owner/repo/tree/main').repositoryPath,
        accepted('github.com/owner/repo').repositoryPath,
      ],
      [
        'https://github.com/microsoft/vscode-remote-try-node',
        'owner/repo/tree/main',
        'github.com/owner/repo',
      ],
    );
  });

  it('F-0701 BR-2: a GitHub URL gives its repository, its branch with slashes, its commit or its pull request', () => {
    const base = 'https://github.com/microsoft/vscode-remote-try-node';
    deepStrictEqual(
      [
        accepted(`${base}/tree/copilot/migrate`),
        accepted(`${base}/commit/45f5e33e47f4b113804ea808b7ce4c90a6823867`),
        accepted(`${base}/pull/161`),
        accepted(`${base}/`),
      ].map(({urlToClone, ref, pullRequest, repositoryName}) => [
        urlToClone,
        ref,
        pullRequest,
        repositoryName,
      ]),
      [
        [base, 'copilot/migrate', undefined, 'vscode-remote-try-node'],
        [
          base,
          '45f5e33e47f4b113804ea808b7ce4c90a6823867',
          undefined,
          'vscode-remote-try-node',
        ],
        [base, undefined, 161, 'vscode-remote-try-node'],
        [base, undefined, undefined, 'vscode-remote-try-node'],
      ],
    );
  });

  it('F-0701 BR-2 host rule: www.github.com and any case are GitHub; another host is used as typed', () => {
    deepStrictEqual(
      [
        accepted('https://www.github.com/o/r/tree/main').ref,
        accepted('https://GitHub.com/o/r/tree/main').ref,
        accepted('https://gitlab.com/g/p/-/tree/b').urlToClone,
        accepted('http://github.com/o/r/tree/main').ref,
      ],
      ['main', 'main', 'https://gitlab.com/g/p/-/tree/b', undefined],
    );
  });

  it('F-0701 BR-2, Q7: the repository name drops .git and ignores trailing slashes on any host', () => {
    deepStrictEqual(
      [
        accepted('git://h.invalid/sweep-broken.git').repositoryName,
        accepted('https://h.invalid/a/b/').repositoryName,
        accepted('git@h.invalid:owner/repo.git').repositoryName,
        accepted('https://github.com/o/r.git/tree/x').urlToClone,
      ],
      ['sweep-broken', 'b', 'repo', 'https://github.com/o/r.git'],
    );
  });

  it('a typed source with no path segment has no repository name', () => {
    deepStrictEqual(
      [
        accepted('/').repositoryName,
        accepted('https://github.com/o/r/blob/x').urlToClone,
      ],
      ['', 'https://github.com/o/r/blob/x'],
    );
  });

  it('a source that git would run a program for, or read as an option, is refused from either origin', () => {
    const refusals = [
      'ext::sh -c touch% /tmp/pwned',
      'fd::17',
      '--upload-pack=touch /tmp/pwned',
      '-c core.sshCommand=touch /tmp/pwned',
      'ssh://-oProxyCommand=touch%20x/r',
      'user@-oProxyCommand=x:path',
      '   ',
    ].flatMap(input =>
      (['typed', 'link'] as const).map(origin => {
        const source = cloneSourceOf(input, origin);
        return 'refused' in source ? source.refused : 'accepted';
      }),
    );
    deepStrictEqual(refusals, [
      'protocol',
      'protocol',
      'protocol',
      'protocol',
      'option',
      'option',
      'option',
      'option',
      'option',
      'option',
      'option',
      'option',
      'empty',
      'empty',
    ]);
  });

  it('from a link, file:// and a local path are refused, and the allowed protocols and forms pass', () => {
    deepStrictEqual(
      [
        'file:///tmp/x',
        '/tmp/x',
        'C:\\repos\\x',
        'ftp://h.invalid/r',
        'https://h.invalid/r',
        'http://h.invalid/r',
        'ssh://git@h.invalid/r',
        'git://h.invalid/r',
        'git@h.invalid:o/r',
        'o/r',
      ].map(input => {
        const source = cloneSourceOf(input, 'link');
        return 'refused' in source ? source.refused : 'accepted';
      }),
      [
        'protocol',
        'notAllowed',
        'notAllowed',
        'notAllowed',
        'accepted',
        'accepted',
        'accepted',
        'accepted',
        'accepted',
        'accepted',
      ],
    );
  });

  it('F-0701 7.E6: a local path, and file://, are sources when the user typed them', () => {
    deepStrictEqual(
      [accepted('/tmp/x').urlToClone, accepted('file:///tmp/x').urlToClone],
      ['/tmp/x', 'file:///tmp/x'],
    );
  });
});

describe('the unique volume’s name (card containers-151)', () => {
  it('F-0701 BR-2: the name, the ref with its slashes as dashes, and the digest of the source as typed', () => {
    deepStrictEqual(
      uniqueVolumeName(
        accepted(
          'https://github.com/microsoft/vscode-remote-try-node/tree/copilot/migrate-repository-from-yarn-to-npm',
        ),
      ),
      'vscode-remote-try-node-copilot-migrate-repository-from-yarn-to-npm-f8539dd0372e09c2c97f53991c29910657b045a6495b187cd7df883b47d3eb42',
    );
  });

  it('F-0701 BR-2, BR-15: a pull request adds pull-<n>, and whitespace around the input makes no other volume', () => {
    const name = uniqueVolumeName(accepted('https://github.com/o/r/pull/161'));
    deepStrictEqual(
      [
        /^r-pull-161-[0-9a-f]{64}$/.test(name),
        uniqueVolumeName(accepted('  https://github.com/o/r/pull/161 ')),
      ],
      [true, name],
    );
  });

  it('F-0701 Q6: characters Docker refuses become dashes in the name only, and a leading one goes', () => {
    const source = accepted('git://h.invalid/f0701-r12-plus+at@name.git');
    deepStrictEqual(
      [
        /^f0701-r12-plus-at-name-[0-9a-f]{64}$/.test(uniqueVolumeName(source)),
        source.repositoryName,
        /^x-[0-9a-f]{64}$/.test(
          uniqueVolumeName(accepted('git://h.invalid/@x')),
        ),
      ],
      [true, 'f0701-r12-plus+at@name', true],
    );
  });
});

describe('the git calls of a clone (card containers-151)', () => {
  it('the source is one element after --, and a link pins the allowed protocols', () => {
    deepStrictEqual(
      [
        lsRemoteArguments(accepted('https://h.invalid/r'), 'typed'),
        lsRemoteArguments(accepted('https://h.invalid/r', 'link'), 'link'),
      ],
      [
        ['ls-remote', '--', 'https://h.invalid/r'],
        [
          '-c',
          'protocol.allow=never',
          '-c',
          'protocol.https.allow=always',
          '-c',
          'protocol.http.allow=always',
          '-c',
          'protocol.ssh.allow=always',
          '-c',
          'protocol.git.allow=always',
          'ls-remote',
          '--',
          'https://h.invalid/r',
        ],
      ],
    );
  });
});
