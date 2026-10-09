import {deepStrictEqual} from 'node:assert';
import {validateTarget} from 'lib-ssh';
import {parseTypedHost} from '../../src/connect/typed-input.ts';

/** The target a typed text parses to, as the validator sees it. */
function checked(input: string) {
  return validateTarget(parseTypedHost(input));
}

describe('parseTypedHost (card remote-ssh-02)', () => {
  it('F-2301.BR-3: a plain host text is the host alone', () => {
    deepStrictEqual(parseTypedHost('plainhost.invalid'), {
      host: 'plainhost.invalid',
    });
  });

  it('F-2301.AC-9: the user before the last at sign', () => {
    deepStrictEqual(parseTypedHost('lab@host.invalid'), {
      host: 'host.invalid',
      user: 'lab',
    });
  });

  it('F-2301.AC-10: the user and the port as a number', () => {
    deepStrictEqual(parseTypedHost('lab@host.invalid:2222'), {
      host: 'host.invalid',
      user: 'lab',
      port: 2222,
    });
  });

  it('F-2301.BR-3: the at sign inside the user stays with the user', () => {
    deepStrictEqual(parseTypedHost('lab@dom@host.invalid'), {
      host: 'host.invalid',
      user: 'lab@dom',
    });
  });

  it('F-2301.BR-3: the trailing digits after a colon are the port', () => {
    deepStrictEqual(parseTypedHost('lowhost.invalid:2200'), {
      host: 'lowhost.invalid',
      port: 2200,
    });
  });

  it('F-2301.BR-3: the spaces as typed are kept', () => {
    deepStrictEqual(parseTypedHost(' lab@trim.invalid '), {
      host: 'trim.invalid ',
      user: ' lab',
    });
  });

  it('F-2301.BR-3: the text before the user is part of the user', () => {
    deepStrictEqual(parseTypedHost('ssh lab@cmd.invalid'), {
      host: 'cmd.invalid',
      user: 'ssh lab',
    });
  });

  it('F-2301.BR-3: a text that starts with an at sign has no user', () => {
    deepStrictEqual(parseTypedHost('@onlyhost.invalid'), {
      host: 'onlyhost.invalid',
    });
  });

  it('F-2301.BR-3: a text that ends with an at sign is the whole host', () => {
    deepStrictEqual(parseTypedHost('lab@'), {host: 'lab@'});
  });

  it('F-2301.BR-3: a non-numeric suffix after a colon stays in the host', () => {
    deepStrictEqual(parseTypedHost('porthost.invalid:abc'), {
      host: 'porthost.invalid:abc',
    });
  });

  it('F-2301.BR-3: a suffix of many digits is the port, no range check', () => {
    deepStrictEqual(parseTypedHost('porthost.invalid:99999'), {
      host: 'porthost.invalid',
      port: 99999,
    });
  });

  it('F-2301.BR-3: an empty suffix after a colon stays in the host', () => {
    deepStrictEqual(parseTypedHost('lab@porthost.invalid:'), {
      host: 'porthost.invalid:',
      user: 'lab',
    });
  });

  it('F-2301.BR-3: only the last colon and digits are the port', () => {
    deepStrictEqual(parseTypedHost('lab@porthost.invalid:22:33'), {
      host: 'porthost.invalid:22',
      user: 'lab',
      port: 33,
    });
  });

  it('F-2301.BR-3: the case of the user and the host is kept', () => {
    deepStrictEqual(
      {
        user: parseTypedHost('LAB@lower.invalid'),
        host: parseTypedHost('Mixed.invalid'),
      },
      {
        user: {host: 'lower.invalid', user: 'LAB'},
        host: {host: 'Mixed.invalid'},
      },
    );
  });

  it('F-2301.BR-3: a user and a bare IPv6 address, no port split', () => {
    deepStrictEqual(parseTypedHost('lab@fe80::1'), {
      host: 'fe80::1',
      user: 'lab',
    });
  });

  it('F-2301.BR-3: a user and a compressed IPv6 address, no port split', () => {
    deepStrictEqual(parseTypedHost('lab@::1'), {host: '::1', user: 'lab'});
  });

  it('F-2301.BR-3: a user and an IPv6 address with letters, no port split', () => {
    deepStrictEqual(parseTypedHost('lab@a::22'), {host: 'a::22', user: 'lab'});
  });

  it('F-2301.BR-3: a user and an IPv6 address with a colon run, no port split', () => {
    deepStrictEqual(parseTypedHost('lab@fe80::1:22'), {
      host: 'fe80::1:22',
      user: 'lab',
    });
  });

  it('F-2301.BR-3: a user and a full-form IPv6 address, no port split', () => {
    deepStrictEqual(parseTypedHost('lab@1:2:3:4:5:6:7:8'), {
      host: '1:2:3:4:5:6:7:8',
      user: 'lab',
    });
  });

  it('F-2301.BR-3: a user and an IPv4-mapped IPv6 address, no port split', () => {
    deepStrictEqual(parseTypedHost('lab@::ffff:1.2.3.4'), {
      host: '::ffff:1.2.3.4',
      user: 'lab',
    });
  });

  it('F-2301.BR-3: a user and an IPv6 address in upper case, no port split', () => {
    deepStrictEqual(parseTypedHost('lab@A::1'), {host: 'A::1', user: 'lab'});
  });

  it('F-2301.BR-3: an IPv6 address alone, no port split', () => {
    deepStrictEqual(parseTypedHost('fe80::1'), {host: 'fe80::1'});
  });

  it('F-2301.BR-3: an IPv6 address with a colon run, no port split', () => {
    deepStrictEqual(parseTypedHost('fe80::1:22'), {host: 'fe80::1:22'});
  });

  it('F-2301.BR-3: a compressed IPv6 address alone, no port split', () => {
    deepStrictEqual(parseTypedHost('::1'), {host: '::1'});
  });

  it('F-2301.BR-3: an IPv4 address with a colon run, the last suffix is the port', () => {
    deepStrictEqual(parseTypedHost('lab@10.0.0.1:22:33'), {
      host: '10.0.0.1:22',
      user: 'lab',
      port: 33,
    });
  });

  it('F-2301.BR-3: an odd colon run is not IPv6, the last suffix is the port', () => {
    deepStrictEqual(
      {
        user: parseTypedHost('lab@a:1:2:3'),
        plain: parseTypedHost('a:1:2'),
      },
      {
        user: {host: 'a:1:2', user: 'lab', port: 3},
        plain: {host: 'a:1', port: 2},
      },
    );
  });

  it('F-2301.BR-3: an invalid colon run is not IPv6, the last suffix is the port', () => {
    deepStrictEqual(parseTypedHost('lab@x::22'), {
      host: 'x:',
      user: 'lab',
      port: 22,
    });
  });

  it('F-2301.BR-3: a too-long colon run is not IPv6, the last group is the port', () => {
    deepStrictEqual(
      {
        long: parseTypedHost('lab@1:2:3:4:5:6:7:8:9'),
        short: parseTypedHost('lab@1:2:3:4:5:6:7'),
      },
      {
        long: {host: '1:2:3:4:5:6:7:8', user: 'lab', port: 9},
        short: {host: '1:2:3:4:5:6', user: 'lab', port: 7},
      },
    );
  });

  it('F-2301.BR-3: a bracketed IPv6 address with a port suffix', () => {
    deepStrictEqual(parseTypedHost('lab@[fe80::1]:22'), {
      host: 'fe80::1',
      user: 'lab',
      port: 22,
    });
  });

  it('F-2301.BR-3: a bracketed IPv6 address without a port', () => {
    deepStrictEqual(
      {
        user: parseTypedHost('lab@[fe80::1]'),
        plain: parseTypedHost('[fe80::1]'),
      },
      {
        user: {host: 'fe80::1', user: 'lab'},
        plain: {host: 'fe80::1'},
      },
    );
  });

  it('F-2301.BR-3: a bracketed text that is not IPv6 keeps its brackets', () => {
    deepStrictEqual(
      {
        plain: parseTypedHost('lab@[x.invalid]'),
        ported: parseTypedHost('lab@[x.invalid]:22'),
      },
      {
        plain: {host: '[x.invalid]', user: 'lab'},
        ported: {host: '[x.invalid]', user: 'lab', port: 22},
      },
    );
  });

  it('F-2301.AC-11: a text that starts with a colon keeps it in the host', () => {
    deepStrictEqual(
      {
        letters: parseTypedHost(':abc'),
        bare: parseTypedHost(':'),
        ported: parseTypedHost(':22:33'),
      },
      {
        letters: {host: ':abc'},
        bare: {host: ':'},
        ported: {host: ':22', port: 33},
      },
    );
  });

  it('F-2301.AC-29: a text of spaces is the host of spaces', () => {
    deepStrictEqual(parseTypedHost('   '), {host: '   '});
  });

  it('F-2301.6.7: the empty text is the empty host', () => {
    deepStrictEqual(parseTypedHost(''), {host: ''});
  });

  it('F-2301.BR-3: every input of the rows above comes back as a target', () => {
    const inputs = [
      'plainhost.invalid',
      'lab@host.invalid',
      'lab@host.invalid:2222',
      'lab@dom@host.invalid',
      'lowhost.invalid:2200',
      ' lab@trim.invalid ',
      'ssh lab@cmd.invalid',
      '@onlyhost.invalid',
      'lab@',
      'porthost.invalid:abc',
      'porthost.invalid:99999',
      'lab@porthost.invalid:',
      'lab@porthost.invalid:22:33',
      'LAB@lower.invalid',
      'Mixed.invalid',
      'lab@fe80::1',
      'lab@::1',
      'lab@a::22',
      'lab@fe80::1:22',
      'lab@1:2:3:4:5:6:7:8',
      'lab@::ffff:1.2.3.4',
      'lab@A::1',
      'fe80::1',
      'fe80::1:22',
      '::1',
      'lab@10.0.0.1:22:33',
      'lab@a:1:2:3',
      'a:1:2',
      'lab@x::22',
      'lab@1:2:3:4:5:6:7:8:9',
      'lab@1:2:3:4:5:6:7',
      'lab@[fe80::1]:22',
      'lab@[fe80::1]',
      '[fe80::1]',
      'lab@[x.invalid]',
      'lab@[x.invalid]:22',
      ':abc',
      ':',
      ':22:33',
      '   ',
      '',
    ];
    let thrown = 0;
    for (const input of inputs) {
      try {
        parseTypedHost(input);
      } catch {
        thrown += 1;
      }
    }
    deepStrictEqual(thrown, 0);
  });
});

describe('the typed text through the validator (card remote-ssh-02)', () => {
  it('F-2301.AC-23: a typed host that starts with a dash is an invalid host', () => {
    deepStrictEqual(checked('-oProxyCommand=x'), {
      kind: 'invalidHost',
      reason: 'S119',
      character: '-',
    });
  });

  it('F-2301.AC-23: a typed host with a forbidden character', () => {
    deepStrictEqual(
      {
        percent: checked('a%b.invalid'),
        slash: checked('a\\b.invalid'),
      },
      {
        percent: {
          kind: 'invalidHost',
          reason: 'S120',
          character: '%',
        },
        slash: {
          kind: 'invalidHost',
          reason: 'S120',
          character: '\\',
        },
      },
    );
  });

  it('F-2301.AC-23: a space in the host is not a name problem here', () => {
    deepStrictEqual(checked('a b.invalid'), undefined);
  });

  it('F-2205.AC-9: a host that starts with a dash, with and without a port', () => {
    deepStrictEqual(
      {
        port: checked('-h:22'),
        percent: checked('u@a%b:2222'),
      },
      {
        port: {kind: 'invalidHost', reason: 'S119', character: '-'},
        percent: {kind: 'invalidHost', reason: 'S120', character: '%'},
      },
    );
  });

  it('F-2205.AC-6: a user that starts with a dash', () => {
    deepStrictEqual(checked('-u@h.invalid'), {
      kind: 'invalidUser',
      reason: 'S121',
      character: '-',
    });
  });

  it('F-2205.AC-7: a user with a forbidden character', () => {
    deepStrictEqual(checked('u!x@h.invalid'), {
      kind: 'invalidUser',
      reason: 'S122',
      character: '!',
    });
  });

  it('F-2205.AC-8: the host is checked before the user', () => {
    deepStrictEqual(
      {
        both: checked('-u@-h'),
        hostFirst: checked('u%@a%b'),
      },
      {
        both: {kind: 'invalidHost', reason: 'S119', character: '-'},
        hostFirst: {kind: 'invalidHost', reason: 'S120', character: '%'},
      },
    );
  });

  it('F-2205.AC-32: a host that starts with a dash, and a host that ends with an at sign', () => {
    deepStrictEqual(
      {
        dash: checked('@-h'),
        ends: checked('u@'),
      },
      {
        dash: {kind: 'invalidHost', reason: 'S119', character: '-'},
        ends: undefined,
      },
    );
  });

  it('F-2205.AC-37: a control character in the host, by its code point', () => {
    deepStrictEqual(
      {
        lineFeed: checked('a\nb'),
        delete: checked('a\x7f'),
      },
      {
        lineFeed: {
          kind: 'invalidHost',
          reason: 'S120',
          character: 'U+000A',
        },
        delete: {
          kind: 'invalidHost',
          reason: 'S120',
          character: 'U+007F',
        },
      },
    );
  });

  it('F-2205.AC-31: an asterisk or a leading point is not a name problem', () => {
    deepStrictEqual(
      {
        star: checked('u*x@h.invalid'),
        point: checked('.u@h.invalid'),
      },
      {star: undefined, point: undefined},
    );
  });

  it('F-2301.AC-31: a big port and a bracketed host are not name problems', () => {
    deepStrictEqual(
      {
        large: checked('porthost.invalid:99999'),
        bracketed: checked('lab@[fe80::1]:22'),
      },
      {large: undefined, bracketed: undefined},
    );
  });
});
