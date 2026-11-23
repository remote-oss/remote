import {deepStrictEqual} from 'node:assert';
import {
  type GithubRepository,
  githubAddressOf,
  githubRepositoryOf,
} from '../../src/explorer/github-repository.ts';

describe('the GitHub repository a label value names, and its address (card containers-170)', () => {
  it('F-0904 BR-3: the GitHub shapes give the owner and the repository, in the value’s case', () => {
    const values = [
      'https://github.com/o/r',
      'https://github.com/o/r.git',
      'https://github.com/o/r/',
      'http://github.com/o/r',
      'https://www.github.com/o/r',
      'https://GitHub.com/Octocat/Linguist',
      'HTTPS://WWW.GITHUB.COM/o/r',
      'https://github.com/o/r/tree/main',
      'https://github.com/o/r/blob/v1/README.md',
      'https://github.com/o/r/pull/8',
      'git@github.com:o/r.git',
      'git@github.com:o/r',
      'ssh://git@github.com/o/r.git',
      'ssh://github.com/o/r',
    ];
    const expected: GithubRepository[] = Array<GithubRepository>(14).fill({
      owner: 'o',
      repository: 'r',
    });
    expected[5] = {owner: 'Octocat', repository: 'Linguist'};
    deepStrictEqual(
      values.map(value => githubRepositoryOf(value)),
      expected,
    );
  });

  it('F-0904 BR-3: an owner-only URL, another host, a look-alike host, another scheme or no URL gives none', () => {
    const values = [
      'https://github.com/o',
      'https://github.com/o/',
      'https://github.example.com/o/r',
      'https://github.com.example.org/o/r',
      'https://notgithub.com/o/r',
      'git://github.com/o/r.git',
      'ftp://github.com/o/r',
      'github.com/o/r',
      'o/r',
      'just text',
      ' https://github.com/o/r',
      'https://github.com/o/.git',
      '',
    ];
    deepStrictEqual(
      values.map(value => githubRepositoryOf(value)),
      Array(13).fill(undefined),
    );
  });

  it('F-0904 BR-4: the link is GitHub’s address of an owner and a repository with GitHub’s name characters', () => {
    const repositories: GithubRepository[] = [
      {owner: 'o', repository: 'r'},
      {owner: 'Octo-cat', repository: 'my_repo.v2'},
      {owner: 'o)', repository: 'r'},
      {owner: 'o', repository: 'r]'},
      {owner: 'o p', repository: 'r'},
      {owner: 'o', repository: 'r\nx'},
      {owner: 'o', repository: ''},
    ];
    const expected = Array<string | undefined>(7).fill(undefined);
    expected[0] = 'https://github.com/o/r';
    expected[1] = 'https://github.com/Octo-cat/my_repo.v2';
    deepStrictEqual(
      repositories.map(repository => githubAddressOf(repository)),
      expected,
    );
  });
});
