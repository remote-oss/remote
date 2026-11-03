import {deepStrictEqual} from 'node:assert';
import {gitRemoteOf} from '../../src/open/git-remote.ts';

describe('the remote of a Git repository (card containers-156)', () => {
  it('F-0708 6.4: the url of origin wins over another remote, and a repository with another remote only gives its first', () => {
    deepStrictEqual(
      [
        gitRemoteOf(
          '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://example.com/up.git\n[remote "origin"]\n\turl = https://example.com/o.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
        ),
        gitRemoteOf(
          '[remote "fork"]\r\n  url = git@example.com:a/b.git  \r\n[remote "other"]\n\turl = https://example.com/x.git\n',
        ),
      ],
      ['https://example.com/o.git', 'git@example.com:a/b.git'],
    );
  });

  it('F-0708 6.4: a file with no remote, with a remote that has no url, or with a url outside a remote gives none, and so does an empty one', () => {
    deepStrictEqual(
      [
        gitRemoteOf(''),
        gitRemoteOf('[core]\n\turl = https://example.com/c.git\n'),
        gitRemoteOf(
          '[remote "origin"]\n\tfetch = x\n[branch "main"]\n\turl = y\n',
        ),
        gitRemoteOf('[remote "origin"]\n\turl =\n'),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('F-0708 6.4: the first url of a remote is the one kept', () => {
    deepStrictEqual(
      gitRemoteOf(
        '[remote "origin"]\n\turl = https://example.com/1.git\n\turl = https://example.com/2.git\n',
      ),
      'https://example.com/1.git',
    );
  });
});
