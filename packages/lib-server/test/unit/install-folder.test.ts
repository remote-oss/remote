import {deepStrictEqual} from 'node:assert';
import {ABSOLUTE_HOST_PATH} from 'lib-host';
import {exactEntry, hostAlias, installFolderFor} from '../../src/index.ts';

describe('the alias that keys the per-host settings', () => {
  it('is the text of a plain target, and the host name of a host target', () => {
    deepStrictEqual(
      [
        hostAlias({kind: 'plain', text: 'devbox'}),
        hostAlias({kind: 'host', hostName: 'devbox.invalid', port: 22}),
      ],
      ['devbox', 'devbox.invalid'],
    );
  });

  it('leaves out the user of user@host, in either form', () => {
    deepStrictEqual(
      [
        hostAlias({kind: 'plain', text: 'alex@devbox'}),
        hostAlias({kind: 'host', hostName: 'alex@devbox'}),
        hostAlias({kind: 'plain', text: 'a@b@devbox'}),
      ],
      ['devbox', 'devbox', 'devbox'],
    );
  });
});

describe('the alias of a host string with a port', () => {
  it('leaves out the port of a plain host string, and keeps an IPv6 address whole', () => {
    deepStrictEqual(
      [
        hostAlias({kind: 'plain', text: 'alex@devbox:2222'}),
        hostAlias({kind: 'plain', text: 'devbox:22'}),
        hostAlias({kind: 'plain', text: '::1'}),
      ],
      ['devbox', 'devbox', '::1'],
    );
  });
});

describe('a map entry for the alias', () => {
  it('matches the key exactly, with its case, and not a wildcard or another case', () => {
    const setting = {devbox: 'one', DEVBOX: 'two', '*': 'star'};
    deepStrictEqual(
      [
        exactEntry(setting, 'devbox'),
        exactEntry(setting, 'DEVBOX'),
        exactEntry(setting, 'Devbox'),
        exactEntry(setting, 'other'),
      ],
      ['one', 'two', undefined, undefined],
    );
  });

  it('gives nothing for a setting that is no map, and not a key it merely inherits', () => {
    deepStrictEqual(
      [
        exactEntry('text', 'devbox'),
        exactEntry(['devbox'], 'devbox'),
        exactEntry(null, 'devbox'),
        exactEntry({}, 'toString'),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });
});

describe('the install folder setting', () => {
  it('uses the entry for the alias exactly as written, a trailing slash included', () => {
    deepStrictEqual(installFolderFor({devbox: '/data/servers/'}, 'devbox'), {
      kind: 'folder',
      folder: '/data/servers/',
    });
  });

  it('accepts the characters the setting allows, upper case and a space included', () => {
    deepStrictEqual(
      installFolderFor({devbox: '/home/Alex/My_Servers-1.0'}, 'devbox'),
      {kind: 'folder', folder: '/home/Alex/My_Servers-1.0'},
    );
  });

  for (const entry of ['~', '~/', '~/My_Servers-1.0']) {
    it(`F-2407 AC-7 (ruling-1277-tilde): ${JSON.stringify(entry)} is used as written, for the host to expand against its home folder`, () => {
      deepStrictEqual(installFolderFor({devbox: entry}, 'devbox'), {
        kind: 'folder',
        folder: entry,
      });
    });
  }

  it('means the default when there is no entry, the entry is empty, or it is not text', () => {
    deepStrictEqual(
      [
        installFolderFor({}, 'devbox'),
        installFolderFor({devbox: ''}, 'devbox'),
        installFolderFor({devbox: 3}, 'devbox'),
        installFolderFor(undefined, 'devbox'),
      ],
      [
        {kind: 'default'},
        {kind: 'default'},
        {kind: 'default'},
        {kind: 'default'},
      ],
    );
  });

  for (const entry of [
    'relative',
    '/a(b)',
    '/a\\b',
    '/a\tb',
    '/ä',
    '~x',
    '~user/x',
    '/a/~',
    '/a/~/b',
    '~~',
    '~/a~',
    '~/a(b)',
    '$HOME/x',
  ]) {
    it(`F-2407: ${JSON.stringify(entry)} is refused and keeps its value as it is stored`, () => {
      deepStrictEqual(installFolderFor({devbox: entry}, 'devbox'), {
        kind: 'invalid',
        value: entry,
      });
    });
  }

  it('F-2407 BR-3, AC-8 (card #3204): a configured install folder with a drive letter is refused here, before the plan, though the shared test of an absolute host path accepts a drive and a separator', () => {
    const entries = ['C:\\vs', 'C:/vs', 'c:\\'];
    deepStrictEqual(
      entries.map(entry => [
        installFolderFor({devbox: entry}, 'devbox').kind,
        entry,
      ]),
      entries.map(entry => ['invalid', entry]),
    );
  });

  it('F-2407 (card #3204): the shared test of an absolute host path takes a POSIX root and a drive with its separator, and refuses a drive alone or with a name', () => {
    deepStrictEqual(
      ['/x', 'C:\\vs', 'C:/vs', 'c:\\', 'C:', 'C:foo'].map(path =>
        ABSOLUTE_HOST_PATH.test(path),
      ),
      [true, true, true, true, false, false],
    );
  });

  it('does not use the entry of another alias, a glob or a user-prefixed key', () => {
    deepStrictEqual(
      installFolderFor({'*': '/x', 'alex@devbox': '/y', other: '/z'}, 'devbox'),
      {kind: 'default'},
    );
  });
});
