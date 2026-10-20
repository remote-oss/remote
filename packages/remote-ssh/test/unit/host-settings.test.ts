import {deepStrictEqual} from 'node:assert';
import {
  effectiveProxyText,
  entryText,
  exactEntry,
  flagOf,
  graceSecondsOf,
  hostAlias,
  installFolderFor,
  preconnectChoiceOf,
  sshTargetOf,
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

describe('the target as ssh is given it', () => {
  it('connect-14: a plain host text is read as typed, with its user and port', () => {
    deepStrictEqual(sshTargetOf({kind: 'plain', text: 'alice@h1:2222'}), {
      host: 'h1',
      user: 'alice',
      port: 2222,
    });
  });

  it('connect-14: a structured host keeps its user and port', () => {
    deepStrictEqual(
      sshTargetOf({kind: 'host', hostName: 'h1', user: 'alice', port: 2222}),
      {host: 'h1', user: 'alice', port: 2222},
    );
  });

  it('connect-14: a structured host with no user or port is the host alone', () => {
    deepStrictEqual(sshTargetOf({kind: 'host', hostName: 'h1'}), {host: 'h1'});
  });
});

describe('what remote.SSH.preconnect asks of a host', () => {
  const NONE = {kind: 'none'};

  it('F-2108 BR-1: a text applies to every host', () => {
    deepStrictEqual(preconnectChoiceOf('/home/a/renew.sh', 'devbox'), {
      kind: 'script',
      path: '/home/a/renew.sh',
    });
  });

  it('F-2108 AC-15: an object applies by the alias exactly as written', () => {
    deepStrictEqual(
      preconnectChoiceOf({devbox: '/home/a/renew.sh'}, 'devbox'),
      {kind: 'script', path: '/home/a/renew.sh'},
    );
  });

  it('F-2108 AC-16: another alias, the same in another case, and a pattern are no script', () => {
    deepStrictEqual(
      [
        preconnectChoiceOf({other: '/x'}, 'devbox'),
        preconnectChoiceOf({DevBox: '/x'}, 'devbox'),
        preconnectChoiceOf({'*': '/x'}, 'devbox'),
      ],
      [NONE, NONE, NONE],
    );
  });

  it('F-2108 6.5 step 4: a matching entry of "" or null is no script', () => {
    deepStrictEqual(
      [
        preconnectChoiceOf({devbox: ''}, 'devbox'),
        preconnectChoiceOf({devbox: null}, 'devbox'),
      ],
      [NONE, NONE],
    );
  });

  it('F-2108 6.6: an absent or empty setting is no script', () => {
    deepStrictEqual(
      [
        preconnectChoiceOf(undefined, 'devbox'),
        preconnectChoiceOf('', 'devbox'),
      ],
      [NONE, NONE],
    );
  });

  it('F-2108 AC-41: a value of another type at the top is no script', () => {
    deepStrictEqual(
      [
        preconnectChoiceOf(true, 'devbox'),
        preconnectChoiceOf(3, 'devbox'),
        preconnectChoiceOf(['/x'], 'devbox'),
        preconnectChoiceOf(null, 'devbox'),
      ],
      [NONE, NONE, NONE, NONE],
    );
  });

  it('F-2108 AC-27: an entry that is a number, a boolean, a list or an object is not the path of a script', () => {
    deepStrictEqual(
      [7, true, ['/x'], {key: 1}].map(entry =>
        preconnectChoiceOf({devbox: entry}, 'devbox'),
      ),
      [
        {kind: 'notAPath', valueKind: 'number'},
        {kind: 'notAPath', valueKind: 'boolean'},
        {kind: 'notAPath', valueKind: 'list'},
        {kind: 'notAPath', valueKind: 'object'},
      ],
    );
  });
});
