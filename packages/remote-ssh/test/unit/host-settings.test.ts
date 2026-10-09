import {deepStrictEqual} from 'node:assert';
import {
  effectiveProxyText,
  entryText,
  exactEntry,
  flagOf,
  graceSecondsOf,
  hostAlias,
  installFolderFor,
} from '../../src/pipeline/host-settings.ts';

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

  it('reads the entry as text, or the empty text for an entry that is not text', () => {
    deepStrictEqual(
      [
        entryText({devbox: '4000-5000'}, 'devbox'),
        entryText({devbox: 7}, 'devbox'),
        entryText({}, 'devbox'),
      ],
      ['4000-5000', '', ''],
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

  it('refuses a folder that is not absolute or holds another character', () => {
    deepStrictEqual(
      [
        installFolderFor({devbox: 'relative'}, 'devbox'),
        installFolderFor({devbox: '/a(b)'}, 'devbox'),
        installFolderFor({devbox: '/a\\b'}, 'devbox'),
        installFolderFor({devbox: '/a\tb'}, 'devbox'),
        installFolderFor({devbox: '/ä'}, 'devbox'),
      ],
      [
        {kind: 'invalid'},
        {kind: 'invalid'},
        {kind: 'invalid'},
        {kind: 'invalid'},
        {kind: 'invalid'},
      ],
    );
  });

  it('does not use the entry of another alias, a glob or a user-prefixed key', () => {
    deepStrictEqual(
      installFolderFor({'*': '/x', 'alex@devbox': '/y', other: '/z'}, 'devbox'),
      {kind: 'default'},
    );
  });
});

describe('the proxy text that applies', () => {
  it('is the text itself when the setting is a text', () => {
    deepStrictEqual(
      effectiveProxyText('http://proxy:3128', 'devbox'),
      'http://proxy:3128',
    );
  });

  it('is the alias entry, else the star entry, else nothing', () => {
    const setting = {devbox: 'http://one:1', '*': 'http://star:2'};
    deepStrictEqual(
      [
        effectiveProxyText(setting, 'devbox'),
        effectiveProxyText(setting, 'other'),
        effectiveProxyText({devbox: 'http://one:1'}, 'other'),
      ],
      ['http://one:1', 'http://star:2', ''],
    );
  });

  it('falls back to the star entry when the alias entry is empty or null', () => {
    deepStrictEqual(
      [
        effectiveProxyText({devbox: '', '*': 'http://star:2'}, 'devbox'),
        effectiveProxyText({devbox: null, '*': 'http://star:2'}, 'devbox'),
      ],
      ['http://star:2', 'http://star:2'],
    );
  });

  it('converts an entry that is not text to text', () => {
    deepStrictEqual(effectiveProxyText({devbox: 8080}, 'devbox'), '8080');
  });

  it('is nothing for a setting that is a number, a flag, a list or empty', () => {
    deepStrictEqual(
      [
        effectiveProxyText(3128, 'devbox'),
        effectiveProxyText(true, 'devbox'),
        effectiveProxyText(['x'], 'devbox'),
        effectiveProxyText('', 'devbox'),
        effectiveProxyText(undefined, 'devbox'),
      ],
      ['', '', '', '', ''],
    );
  });
});

describe('the reconnection grace time and the flags', () => {
  it('passes a number of 1 or more and reads unset, 0, negative and other values as none', () => {
    deepStrictEqual(
      [
        graceSecondsOf(300),
        graceSecondsOf(1),
        graceSecondsOf(0),
        graceSecondsOf(-5),
        graceSecondsOf(null),
        graceSecondsOf('300'),
        graceSecondsOf(undefined),
      ],
      [300, 1, 0, 0, 0, 0, 0],
    );
  });

  it('takes a flag as it is and anything else as the declared default', () => {
    deepStrictEqual(
      [
        flagOf(true, false),
        flagOf(false, true),
        flagOf('yes', true),
        flagOf(undefined, false),
      ],
      [true, false, true, false],
    );
  });
});
