import {deepStrictEqual} from 'node:assert';
import {
  distroToShare,
  isWindowsMountShape,
  parseWslpathOutput,
  shareToDistro,
} from '../../src/index.ts';

function share(distro: string, linuxPath: string) {
  return {kind: 'share', distro, linuxPath};
}

describe('shareToDistro', () => {
  it('F-6204.BR-1: reads a wsl.localhost path', () => {
    deepStrictEqual(
      shareToDistro('\\\\wsl.localhost\\Ubuntu\\home\\lex\\proj'),
      share('Ubuntu', '/home/lex/proj'),
    );
  });

  it('F-6204.BR-1: reads a wsl$ path', () => {
    deepStrictEqual(
      shareToDistro('\\\\wsl$\\Ubuntu\\home\\lex\\proj'),
      share('Ubuntu', '/home/lex/proj'),
    );
  });

  it('F-6204.BR-1: ignores the case of the wsl.localhost host', () => {
    deepStrictEqual(
      shareToDistro('\\\\WSL.LocalHost\\Ubuntu\\a'),
      share('Ubuntu', '/a'),
    );
  });

  it('F-6204.BR-1: ignores the case of the wsl$ host', () => {
    deepStrictEqual(
      shareToDistro('\\\\WSL$\\Ubuntu\\a'),
      share('Ubuntu', '/a'),
    );
  });

  it('F-6204.BR-1: returns the distro as written', () => {
    deepStrictEqual(
      shareToDistro('\\\\wsl.localhost\\ubuntu\\a'),
      share('ubuntu', '/a'),
    );
  });

  it('F-6204.BR-1: a distro alone is the root', () => {
    deepStrictEqual(
      shareToDistro('\\\\wsl.localhost\\Ubuntu'),
      share('Ubuntu', '/'),
    );
  });

  it('F-6204.BR-1: a distro and a backslash is the root', () => {
    deepStrictEqual(
      shareToDistro('\\\\wsl.localhost\\Ubuntu\\'),
      share('Ubuntu', '/'),
    );
  });

  it('F-6204.BR-2: keeps spaces and non-ASCII characters and a trailing separator', () => {
    deepStrictEqual(
      shareToDistro('\\\\wsl.localhost\\fixture γ\\home\\a b\\dir\\'),
      share('fixture γ', '/home/a b/dir/'),
    );
  });

  const notShares = [
    'C:\\Users\\lex',
    '\\\\server\\share\\x',
    '\\\\wsl.localhost',
    '\\\\wsl.localhost\\',
    '\\\\wsl.localhostx\\Ubuntu\\a',
    '',
  ];
  for (const path of notShares) {
    it(`F-6204.BR-1: ${JSON.stringify(path)} is not a share`, () => {
      deepStrictEqual(shareToDistro(path), {kind: 'notShare'});
    });
  }
});

describe('distroToShare', () => {
  it('F-6207.BR-3: turns a Linux path into a wsl.localhost path', () => {
    deepStrictEqual(
      distroToShare('Ubuntu', '/home/lex/proj'),
      '\\\\wsl.localhost\\Ubuntu\\home\\lex\\proj',
    );
  });

  it('F-6204.BR-2: keeps spaces and non-ASCII characters', () => {
    deepStrictEqual(
      distroToShare('fixture γ', '/home/a b/é'),
      '\\\\wsl.localhost\\fixture γ\\home\\a b\\é',
    );
  });

  it('F-6207.BR-3: the root gives the share root', () => {
    deepStrictEqual(
      distroToShare('Ubuntu', '/'),
      '\\\\wsl.localhost\\Ubuntu\\',
    );
  });

  const roundTrips = [
    ['Ubuntu', '/'],
    ['Ubuntu', '/a/b'],
    ['fixture γ', '/x y'],
  ] as const;
  for (const [distro, linuxPath] of roundTrips) {
    it(`F-6204.BR-2: ${distro} ${linuxPath} survives the round trip`, () => {
      deepStrictEqual(
        shareToDistro(distroToShare(distro, linuxPath)),
        share(distro, linuxPath),
      );
    });
  }
});

describe('isWindowsMountShape', () => {
  for (const path of ['/mnt/c/x', '/mnt/d/a/b']) {
    it(`F-6206.BR-1: ${path} is a mount shape`, () => {
      deepStrictEqual(isWindowsMountShape(path), true);
    });
  }

  for (const path of [
    '/mnt/cd/x',
    '/win/c/x',
    '/mnt/1/x',
    '/mnt/',
    '/home/mnt/c/x',
  ]) {
    it(`F-6206.BR-1: ${path} is not a mount shape`, () => {
      deepStrictEqual(isWindowsMountShape(path), false);
    });
  }
});

describe('parseWslpathOutput', () => {
  it('contracts.md §1 D3: drops one line feed', () => {
    deepStrictEqual(parseWslpathOutput('/mnt/c/Users/a b\n'), {
      kind: 'path',
      path: '/mnt/c/Users/a b',
    });
  });

  it('contracts.md §1 D3: drops one carriage return and line feed', () => {
    deepStrictEqual(parseWslpathOutput('/mnt/c/Users/a b\r\n'), {
      kind: 'path',
      path: '/mnt/c/Users/a b',
    });
  });

  it('contracts.md §1 D3: keeps a path with no line end unchanged', () => {
    deepStrictEqual(parseWslpathOutput('C:\\Users\\é'), {
      kind: 'path',
      path: 'C:\\Users\\é',
    });
  });

  for (const text of ['', '\n', 'a\nb\n']) {
    it(`contracts.md §1 D3: ${JSON.stringify(text)} is unusable`, () => {
      deepStrictEqual(parseWslpathOutput(text), {kind: 'unusable'});
    });
  }
});
