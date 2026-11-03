import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  mirroredFolderIn,
  mirroredPathsOf,
  remoteUrlsOf,
  repositoryRootsOf,
} from '../../src/config/mirrored-paths.ts';

describe('the path a remote maps to under a root (card containers-161, F-0302 BR-1)', () => {
  it('F-0302 BR-1: https keeps the whole authority, userinfo and port included, and the case, and loses a trailing .git', () => {
    deepStrictEqual(
      [
        'https://github.com/Owner/Name.git',
        'https://github.com/owner/name',
        'https://user@host.example:8443/o/n.git',
        'https://HOST/o/n.git.git',
      ].map(mirroredPathsOf),
      [
        ['github.com/Owner/Name'],
        ['github.com/owner/name'],
        ['user@host.example:8443/o/n'],
        ['HOST/o/n.git'],
      ],
    );
  });

  it('F-0302 BR-1: the scp form maps to <host>/<path> without its user', () => {
    deepStrictEqual(
      [
        'git@github.com:owner/name.git',
        'github.com:owner/name',
        'git@host.example:group/sub/name.git',
      ].map(mirroredPathsOf),
      [
        ['github.com/owner/name'],
        ['github.com/owner/name'],
        ['host.example/group/sub/name'],
      ],
    );
  });

  it('F-0302 BR-1: ssh:// with a port maps to <host>/<port>/<path>', () => {
    deepStrictEqual(
      ['ssh://git@host.example:2222/o/n.git', 'ssh://host.example:22/o/n'].map(
        mirroredPathsOf,
      ),
      [['host.example/2222/o/n'], ['host.example/22/o/n']],
    );
  });

  it('F-0302 Q2, 7.E3, 7.E6: git:// and ssh:// without a port map to <host>/<path>', () => {
    deepStrictEqual(
      [
        'git://10.0.0.7/owner/name.git',
        'git://host.example/owner/name',
        'ssh://git@host.example/owner/name.git',
        'ssh://host.example/owner/name',
      ].map(mirroredPathsOf),
      [
        ['10.0.0.7/owner/name'],
        ['host.example/owner/name'],
        ['host.example/owner/name'],
        ['host.example/owner/name'],
      ],
    );
  });

  it('F-0302 BR-1: a URL of another form names nothing: http://, file://, a path, a drive path, a host alone', () => {
    deepStrictEqual(
      [
        'http://host.example/o/n.git',
        'file:///srv/o/n.git',
        '/srv/o/n.git',
        '../o/n',
        'C:\\o\\n',
        'c:/o/n',
        'd:foo',
        'https://host.example',
        'host.example',
        'git@host.example:/abs/n.git',
        'ssh://host.example:abc/o/n',
        '',
      ].map(mirroredPathsOf),
      Array.from({length: 12}, () => []),
    );
  });

  it('F-0302 BR-1: a path with an empty, . or .. segment, a backslash or a control character names nothing', () => {
    deepStrictEqual(
      [
        'https://host/../../x',
        'git@host:../x',
        'git@host:o/./n',
        'https://host/o//n',
        'https://host/o/n/',
        'ssh://host/o\\n',
        'git@host:o/n\u0000x',
        'git://host/o/n\u001f',
        'https://host/o/\u007fn',
      ].map(mirroredPathsOf),
      Array.from({length: 9}, () => []),
    );
  });
});

describe('a mirrored folder stays under its root (card containers-161, dike and proteus on #2015)', () => {
  it('F-0302 BR-1: the folder is the root joined with the path, resolved', () => {
    deepStrictEqual(
      mirroredFolderIn('/r', 'host/o/n'),
      path.resolve('/r/host/o/n'),
    );
  });

  it('F-0302 BR-1: a path that resolves outside the root, or into a sibling whose name starts with the root’s, is refused', () => {
    deepStrictEqual(
      [
        mirroredFolderIn('/r', '../x'),
        mirroredFolderIn('/r', 'a/../../x'),
        mirroredFolderIn('/r', '../r2/x'),
        mirroredFolderIn('/r', '..'),
        mirroredFolderIn('/r', 'a/..'),
      ],
      [undefined, undefined, undefined, undefined, undefined],
    );
  });

  it('F-0302 BR-1: a root with a trailing separator, and the root of the file system, work as any other', () => {
    deepStrictEqual(
      [
        mirroredFolderIn('/r/', 'host/o'),
        mirroredFolderIn(path.parse(process.cwd()).root, 'host/o'),
      ],
      [
        path.resolve('/r/host/o'),
        path.resolve(path.parse(process.cwd()).root, 'host/o'),
      ],
    );
  });
});

describe('the roots the setting names (card containers-161, F-0302 BR-7, BR-9)', () => {
  it('F-0302 BR-9: literal absolute paths are roots, a trailing slash makes no difference, and the order is the setting’s', () => {
    deepStrictEqual(repositoryRootsOf(['/b/root/', '/a/root', '/b/root']), [
      path.resolve('/b/root'),
      path.resolve('/a/root'),
      path.resolve('/b/root'),
    ]);
  });

  it('F-0302 AC-36: ~, ${env:…}, ${userHome}, a relative path, a value that is no text and a setting that is no list are no roots', () => {
    deepStrictEqual(
      [
        repositoryRootsOf([
          '~/configs',
          '${env:HOME}/configs',
          '${userHome}/configs',
          '/ok/${workspaceFolder}',
          'relative/path',
          '',
          7,
          null,
          {path: '/x'},
        ]),
        repositoryRootsOf('/not/a/list'),
        repositoryRootsOf(undefined),
      ],
      [[], [], []],
    );
  });
});

describe('the URLs of the remotes (card containers-161, F-0302 BR-1)', () => {
  it('F-0302 AC-31: every remote’s URL is read, in the order printed, and two remotes with one URL count once', () => {
    deepStrictEqual(
      remoteUrlsOf(
        [
          'remote.origin.url https://github.com/o/n.git',
          'remote.upstream.url git@github.com:u/n.git',
          'remote.mirror.url https://github.com/o/n.git',
          '',
        ].join('\n'),
      ),
      ['https://github.com/o/n.git', 'git@github.com:u/n.git'],
    );
  });

  it('F-0302 BR-1: a remote whose name has dots, a URL with spaces around it and a line with no URL are read as the lines say', () => {
    deepStrictEqual(
      remoteUrlsOf('remote.a.b.url   https://h/o/n  \nremote.c.url\n\n'),
      ['https://h/o/n'],
    );
  });

  it('F-0302 7.E1: nothing printed is no remote', () => {
    deepStrictEqual(remoteUrlsOf(''), []);
  });
});
