import {deepStrictEqual} from 'node:assert';
import {parseAddHostCommand} from '../../src/index.ts';
import type {AddHostResult} from '../../src/index.ts';

/** The problem a command without a host gets. */
function missingHost(): AddHostResult {
  return {
    problem: {
      kind: 'missingHost',
      message: 'Missing host in SSH connection string',
    },
  };
}

/** The block the row's notation calls "alias; rest", the HostName line first. */
function block(
  alias: string,
  rest: Array<[string, string]> = [],
): AddHostResult {
  return {
    block: {
      alias,
      lines: [
        {keyword: 'HostName', value: alias},
        ...rest.map(([keyword, value]) => ({keyword, value})),
      ],
    },
  };
}

/** The block of one command. */
function parse(command: string): AddHostResult {
  return parseAddHostCommand(command);
}

describe('parseAddHostCommand (the Host block of a typed command)', () => {
  const PLAIN_COMMANDS = ['host1', '  ssh   host1  '] as const;
  for (const command of PLAIN_COMMANDS) {
    it(`F-2204.BR-1: a command of ${JSON.stringify(command)} names its host`, () => {
      deepStrictEqual(parse(command), block('host1'));
    });
  }

  it('F-2204.BR-1: a user at the destination names the User line', () => {
    deepStrictEqual(parse('user@host'), block('host', [['User', 'user']]));
  });

  it('F-2204.BR-4: a scheme with a user', () => {
    deepStrictEqual(
      parse('ssh://user@host'),
      block('host', [['User', 'user']]),
    );
  });

  it('F-2204.BR-4: a scheme with a port', () => {
    deepStrictEqual(
      parse('ssh://host:2222'),
      block('host', [['Port', '2222']]),
    );
  });

  it('F-2204.BR-4: the last @ gives the user', () => {
    deepStrictEqual(parse('a@b@host45'), block('host45', [['User', 'a@b']]));
  });

  it('F-2204.BR-4: the alias keeps its letters', () => {
    deepStrictEqual(parse('HOST20'), block('HOST20'));
  });

  it('F-2204.BR-10: flags before the destination', () => {
    deepStrictEqual(
      parse('ssh -p 2222 -i ~/.ssh/key user@host4'),
      block('host4', [
        ['Port', '2222'],
        ['IdentityFile', '~/.ssh/key'],
        ['User', 'user'],
      ]),
    );
  });

  const JOINED_FLAG_COMMANDS: Array<[string, Array<[string, string]>]> = [
    ['-p2222 host', [['Port', '2222']]],
    ['-oUser=dan host', [['User', 'dan']]],
    [
      '-AC host',
      [
        ['ForwardAgent', 'yes'],
        ['Compression', 'yes'],
      ],
    ],
  ];
  for (const [command, rest] of JOINED_FLAG_COMMANDS) {
    it(`F-2204.BR-3: the flags of ${command} join or read their letters`, () => {
      deepStrictEqual(parse(command), block('host', rest));
    });
  }

  const VALUE_FLAG_COMMANDS: Array<[string, [string, string]]> = [
    ['-l bob h', ['User', 'bob']],
    ['-i k h', ['IdentityFile', 'k']],
    ['-J jump h', ['ProxyJump', 'jump']],
    ['-D 1080 h', ['DynamicForward', '1080']],
    ['-R 9000:localhost:22 h', ['RemoteForward', '9000:localhost:22']],
    ['-S /tmp/s h', ['ControlPath', '/tmp/s']],
    ['-m hmac h', ['MACs', 'hmac']],
    ['-b 0.0.0.0 h', ['BindAddress', '0.0.0.0']],
    ['-w 0:0 h', ['TunnelDevice', '0:0']],
  ];
  for (const [command, line] of VALUE_FLAG_COMMANDS) {
    it(`F-2204.BR-5: the flag of ${command} writes one line`, () => {
      deepStrictEqual(parse(command), block('h', [line]));
    });
  }

  const FIXED_FLAG_COMMANDS: Array<[string, [string, string]]> = [
    ['-A h', ['ForwardAgent', 'yes']],
    ['-v h', ['LogLevel', 'verbose']],
    ['-C h', ['Compression', 'yes']],
    ['-X h', ['ForwardX11', 'yes']],
    ['-x h', ['ForwardX11', 'no']],
    ['-Y h', ['ForwardX11Trusted', 'yes']],
    ['-4 h', ['AddressFamily', 'inet']],
    ['-6 h', ['AddressFamily', 'inet6']],
    ['-k h', ['GSSAPIDelegateCredentials', 'no']],
    ['-K h', ['GSSAPIAuthentication', 'yes']],
    ['-g h', ['GatewayPorts', 'yes']],
    ['-M h', ['ControlMaster', 'yes']],
  ];
  for (const [command, line] of FIXED_FLAG_COMMANDS) {
    it(`F-2204.BR-5: the flag of ${command} writes its fixed line`, () => {
      deepStrictEqual(parse(command), block('h', [line]));
    });
  }

  it('F-2204.BR-5: a local forward splits at the last colon pair', () => {
    deepStrictEqual(
      parse('-L 8080:localhost:80 h'),
      block('h', [['LocalForward', '8080 localhost:80']]),
    );
  });

  it('F-2204.BR-5: a local forward with a bind address', () => {
    deepStrictEqual(
      parse('-L 127.0.0.1:8080:localhost:80 h'),
      block('h', [['LocalForward', '127.0.0.1:8080 localhost:80']]),
    );
  });

  it('F-2204.BR-5 (adapted): the ciphers and the provider flag', () => {
    deepStrictEqual(
      parse('-c aes128-ctr -I /usr/lib/p.so h'),
      block('h', [
        ['Ciphers', 'aes128-ctr'],
        ['PKCS11Provider', '/usr/lib/p.so'],
      ]),
    );
  });

  it('F-2204.BR-5 (adapted): the standard input flag consumes its target', () => {
    deepStrictEqual(parse('-W target:22 h'), block('h'));
  });

  const SILENT_FLAGS = [
    't',
    'T',
    'N',
    'f',
    'n',
    's',
    'q',
    'G',
    'V',
    'y',
    'a',
  ] as const;
  for (const letter of SILENT_FLAGS) {
    it(`F-2204.BR-6: the flag -${letter} writes nothing`, () => {
      deepStrictEqual(parse(`-${letter} h`), block('h'));
    });
  }

  const SILENT_ARGUMENT_FLAGS: Array<[string, string]> = [
    ['F', 'cfg'],
    ['E', 'log'],
    ['e', '^'],
    ['B', 'addr'],
    ['O', 'check'],
    ['Q', 'cipher'],
  ];
  for (const [letter, argument] of SILENT_ARGUMENT_FLAGS) {
    it(`F-2204.BR-6: the flag -${letter} consumes its argument ${argument}`, () => {
      deepStrictEqual(parse(`-${letter} ${argument} h`), block('h'));
    });
  }

  it('F-2204.BR-6 (adapted): the program flag consumes its argument', () => {
    deepStrictEqual(parse('-P tag host36'), block('host36'));
  });

  const OPTION_COMMANDS: Array<[string, Array<[string, string]>]> = [
    ['-o Foo=bar h', [['Foo', 'bar']]],
    ['-o port=2201 h', [['port', '2201']]],
    ['-o HostName=x h', []],
    ['-o hostname=h44 h', [['hostname', 'h44']]],
  ];
  for (const [command, rest] of OPTION_COMMANDS) {
    it(`F-2204.BR-7: the option of ${command} writes its keyword`, () => {
      deepStrictEqual(parse(command), block('h', rest));
    });
  }

  it('F-2204.BR-7: a quoted option keeps its blanks', () => {
    deepStrictEqual(
      parse('-o "Foo=bar baz" h'),
      block('h', [['Foo', 'bar baz']]),
    );
  });

  it('F-2204.BR-7: a quoted proxy command keeps its placeholders', () => {
    deepStrictEqual(
      parse('-o "ProxyCommand=nc %h %p" h'),
      block('h', [['ProxyCommand', 'nc %h %p']]),
    );
  });

  it('F-2204.BR-8: a quoted identity file', () => {
    deepStrictEqual(
      parse('-i "~/my key" h'),
      block('h', [['IdentityFile', '"~/my key"']]),
    );
  });

  it('F-2204.BR-8: a quoted user', () => {
    deepStrictEqual(parse("-l 'bo b' h"), block('h', [['User', '"bo b"']]));
  });

  it('F-2204.BR-8: a quoted identity file through an option', () => {
    deepStrictEqual(
      parse('-o "IdentityFile=~/my key" h'),
      block('h', [['IdentityFile', '"~/my key"']]),
    );
  });

  it('F-2204.BR-8: a port of letters', () => {
    deepStrictEqual(parse('-p abc h'), block('h', [['Port', 'abc']]));
  });

  it('F-2204.BR-8: a user starting with a dash', () => {
    deepStrictEqual(parse('-l -bob h'), block('h', [['User', '-bob']]));
  });

  it('F-2204.BR-8: a host of bangs', () => {
    deepStrictEqual(parse('!!!'), block('!!!'));
  });

  it('F-2204.BR-2: a backslash joins a broken word', () => {
    deepStrictEqual(
      parse('-i my\\ key h'),
      block('h', [['IdentityFile', '"my key"']]),
    );
  });

  it('F-2204.BR-2: the double dash ends the flags', () => {
    deepStrictEqual(parse('ssh -- -bad'), block('-bad'));
  });

  it('F-2204.BR-2: the double dash after flags', () => {
    deepStrictEqual(parse('ssh -p 22 -- h'), block('h', [['Port', '22']]));
  });

  it('F-2204.BR-9: the flag user outranks the destination user', () => {
    deepStrictEqual(
      parse('-l bob carol@host46'),
      block('host46', [['User', 'bob']]),
    );
  });

  const LAST_VALUE_COMMANDS: Array<[string, Array<[string, string]>]> = [
    ['-p 2222 -p 3333 h', [['Port', '3333']]],
    ['-o ForwardAgent=no -A h', [['ForwardAgent', 'yes']]],
    ['-A -o ForwardAgent=no h', [['ForwardAgent', 'no']]],
    [
      '-p 1 -i k -p 2 h',
      [
        ['Port', '2'],
        ['IdentityFile', 'k'],
      ],
    ],
  ];
  for (const [command, rest] of LAST_VALUE_COMMANDS) {
    it(`F-2204.BR-9: one line per keyword in ${command}`, () => {
      deepStrictEqual(parse(command), block('h', rest));
    });
  }

  const MISSING_HOST_COMMANDS = [
    '',
    'ssh',
    'ssh -p 22',
    '-oProxyCommand=x',
    'user@',
  ] as const;
  for (const command of MISSING_HOST_COMMANDS) {
    it(`F-2204.7.E1: a command of ${JSON.stringify(command)} names no host`, () => {
      deepStrictEqual(parse(command), missingHost());
    });
  }

  it('F-2204.7.E8: a user part of an empty name', () => {
    deepStrictEqual(parse('@host47'), block('host47'));
  });

  it('F-2204.7.E8: a quote never closed is ignored', () => {
    deepStrictEqual(
      parse('ssh -i "unterminated host49'),
      block('host49', [['IdentityFile', 'unterminated']]),
    );
  });

  it('F-2204.7.E8: a variable part is dropped', () => {
    deepStrictEqual(parse('host54$x'), block('host54'));
  });

  it('F-2204.7.E9: a bare IPv6 address with a user', () => {
    deepStrictEqual(
      parse('user@fe80::1'),
      block('fe80::1', [['User', 'user']]),
    );
  });

  it('F-2204.7.E9: a bare IPv6 address', () => {
    deepStrictEqual(parse('::1'), block('::1'));
  });

  it('F-2204.BR-8: a port of letters at the destination', () => {
    deepStrictEqual(parse('host:abc'), block('host', [['Port', 'abc']]));
  });

  it('F-2204.BR-10: a user and a port at the destination', () => {
    deepStrictEqual(
      parse('user@host:2222'),
      block('host', [
        ['User', 'user'],
        ['Port', '2222'],
      ]),
    );
  });

  it('F-2204.7.E5: the first shell character stops the command', () => {
    deepStrictEqual(parse('a;b|c'), {
      problem: {kind: 'shellCharacter', character: ';'},
    });
  });

  it('F-2204.BR-8: a local forward without a target', () => {
    deepStrictEqual(parse('-L 8080 h'), block('h', [['LocalForward', '8080']]));
  });

  it('F-2204.7.E9 (provisional): a user at a bracketed address', () => {
    deepStrictEqual(parse('user@[::1]'), block('::1', [['User', 'user']]));
  });

  it('F-2204.7.E9 (provisional): a bracketed address with a port', () => {
    deepStrictEqual(parse('[::1]:2222'), block('::1', [['Port', '2222']]));
  });

  it('F-2204.BR-8 (provisional): an unclosed bracket stays whole', () => {
    deepStrictEqual(parse('[::1'), block('[::1'));
  });

  it('F-2204.BR-8 (provisional): two colons keep the name whole', () => {
    deepStrictEqual(parse('host:1:2'), block('host:1:2'));
  });

  it('F-2204.BR-8 (provisional): a trailing colon names no port', () => {
    deepStrictEqual(parse('host:'), block('host'));
  });
});
