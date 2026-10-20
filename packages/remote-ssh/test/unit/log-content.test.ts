import {deepStrictEqual, ok} from 'node:assert';
import type {ResultBlock} from 'lib-server';
import {
  bannerLine,
  checkingLine,
  configFileLine,
  hostPlatformLine,
  notValidLine,
  pathSettingLine,
  rejectedLine,
  type ResolveRecord,
  resolveLogLines,
  searchedLines,
  serverResultLine,
  usingLine,
} from '../../src/diagnostics/log-content.ts';

const RULE = '-'.repeat(40);

const WINDOW_START = {
  editorVersion: '1.2.3',
  extensionName: 'remote-ssh',
  extensionVersion: '0.1.0',
  platform: 'linux',
  architecture: 'arm64',
  searchedFolders: ['/usr/bin', '/usr/local/bin'],
  clientBanner: 'OpenSSH_9.9p1',
};

function recordWith(overrides: Partial<ResolveRecord> = {}): ResolveRecord {
  return {
    authority: 'host1.invalid',
    attempt: 1,
    reconnection: false,
    level: 'debug',
    windowStart: WINDOW_START,
    settings: [
      {name: 'useLocalServer', value: 'true'},
      {name: 'path', value: 'undefined'},
    ],
    sshStarted: true,
    sshLines: [
      'debug1: Server host key: ssh-ed25519 SHA256:abc',
      'debug1: Authenticating to host1.invalid:22',
      'Warning: Permanently added host1.invalid',
    ],
    prompts: [{text: 'Password: ', answer: 'hunter2'}],
    connectionToken: 'ab12-cd34',
    remoteOutput: ['installing', 'token ab12-cd34 ready'],
    listeningPort: 40000,
    resolvedPort: 50000,
    summary: {kind: 'none'},
    serverOutput: ['Downloading 50%'],
    ...overrides,
  };
}

function without(
  record: ResolveRecord,
  field: 'windowStart' | 'listeningPort' | 'resolvedPort' | 'connectionToken',
): ResolveRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== field),
  ) as unknown as ResolveRecord;
}

function linesOf(overrides: Partial<ResolveRecord> = {}): string[] {
  return resolveLogLines(recordWith(overrides));
}

const NO_HINTS = 'No hints found in the recent session.';
const EMPTY_LINES = ['', '', '', ''];

describe('resolveLogLines (card connect-04 table)', () => {
  it('F-2003.AC-11 / F-2003.BR-6: writes the whole log of a resolve in order', () => {
    deepStrictEqual(linesOf(), [
      'Log level: debug',
      'Resolving ssh-remote+host1.invalid, attempt 1',
      'remote.SSH.useLocalServer = true',
      'remote.SSH.path = undefined',
      'VS Code version: 1.2.3',
      'Extension: remote-ssh 0.1.0',
      'Platform: linux arm64',
      'Searched for ssh in: /usr/bin',
      'Searched for ssh in: /usr/local/bin',
      'ssh client: OpenSSH_9.9p1',
      'Started ssh',
      '[ssh] debug1: Server host key: ssh-ed25519 SHA256:abc',
      '[ssh] Warning: Permanently added host1.invalid',
      'Prompt: Password: ',
      'Answer: ***',
      '[remote] installing',
      '[remote] token aa11-aa11 ready',
      'Remote server listening on port 40000',
      'Resolved ssh-remote+host1.invalid to local port 50000',
      RULE,
      ...EMPTY_LINES,
      NO_HINTS,
      '[server] Downloading 50%',
    ]);
  });

  it('F-2003.BR-6 item 1: a reconnection ends the resolver line with the word', () => {
    deepStrictEqual(
      linesOf({attempt: 2, reconnection: true})[1],
      'Resolving ssh-remote+host1.invalid, attempt 2, reconnection',
    );
  });

  it('F-2003.BR-6 item 1: a first connection does not mention reconnection', () => {
    ok(!linesOf({reconnection: false})[1]?.includes('reconnection'));
  });

  it('F-2003.BR-5: a resolve that is not the first operation writes no window lines', () => {
    deepStrictEqual(
      resolveLogLines(without(recordWith(), 'windowStart')).slice(0, 3),
      [
        'Resolving ssh-remote+host1.invalid, attempt 1',
        'remote.SSH.useLocalServer = true',
        'remote.SSH.path = undefined',
      ],
    );
  });

  it('F-2003.BR-5: no window line appears without the window start', () => {
    deepStrictEqual(
      resolveLogLines(without(recordWith(), 'windowStart')).filter(line =>
        /^(Log level:|VS Code version:|Extension:|Platform:|Searched for ssh in:|ssh client:)/.test(
          line,
        ),
      ),
      [],
    );
  });

  it('F-2003.BR-6 item 2: no settings give no setting line', () => {
    deepStrictEqual(
      linesOf({settings: []}).filter(line => line.startsWith('remote.SSH.')),
      [],
    );
  });

  it('F-2003.BR-6 item 2: many settings are written in the given order', () => {
    const settings = Array.from({length: 23}, (ignored, index) => ({
      name: `setting${String(index + 1).padStart(2, '0')}`,
      value: `v${String(index + 1)}`,
    }));
    deepStrictEqual(
      linesOf({settings}).slice(2, 25),
      settings.map(setting => `remote.SSH.${setting.name} = ${setting.value}`),
    );
  });

  it('F-2003.BR-6 item 4: no searched folder still writes the client line', () => {
    deepStrictEqual(
      linesOf({windowStart: {...WINDOW_START, searchedFolders: []}}).filter(
        line => /^(Searched for ssh in|ssh client):/.test(line),
      ),
      ['ssh client: OpenSSH_9.9p1'],
    );
  });

  it('F-2003.BR-6 item 5: ssh that did not start writes no start line', () => {
    ok(!linesOf({sshStarted: false}).includes('Started ssh'));
  });

  const sshLines = [
    'debug1: Server host key: ssh-ed25519 SHA256:abc',
    'debug1: other',
    'debug2: x',
    'Warning: y',
    'Authenticated to h ([127.0.0.1]:22) using "publickey".',
  ];

  it('F-2003.BR-8: the debug level keeps the ssh lines logLinesOf keeps', () => {
    deepStrictEqual(
      linesOf({sshLines, level: 'debug'}).filter(line =>
        line.startsWith('[ssh] '),
      ),
      [
        '[ssh] debug1: Server host key: ssh-ed25519 SHA256:abc',
        '[ssh] debug2: x',
        '[ssh] Warning: y',
        '[ssh] Authenticated to h ([127.0.0.1]:22) using "publickey".',
      ],
    );
  });

  it('F-2003.BR-9: the trace level keeps every ssh line', () => {
    deepStrictEqual(
      linesOf({sshLines, level: 'trace'}).filter(line =>
        line.startsWith('[ssh] '),
      ),
      sshLines.map(line => `[ssh] ${line}`),
    );
  });

  it('F-2003.AC-24: failure lines of ssh are written verbatim', () => {
    deepStrictEqual(
      linesOf({
        sshLines: [
          'channel 2: open failed: administratively prohibited: open failed',
          'ssh: connect to host 192.0.2.1 port 22: Connection refused',
        ],
      }).filter(line => line.startsWith('[ssh] ')),
      [
        '[ssh] channel 2: open failed: administratively prohibited: open failed',
        '[ssh] ssh: connect to host 192.0.2.1 port 22: Connection refused',
      ],
    );
  });

  it('F-2003.BR-6 item 6: no ssh line gives no ssh entry', () => {
    deepStrictEqual(
      linesOf({sshLines: []}).filter(line => line.startsWith('[ssh]')),
      [],
    );
  });

  it('F-2003.BR-6 item 7: each prompt is followed by a masked answer', () => {
    deepStrictEqual(
      linesOf({
        prompts: [
          {text: "Enter passphrase for key '/k': ", answer: 'pw1'},
          {
            text: 'Are you sure you want to continue connecting (yes/no)? ',
            answer: 'yes',
          },
        ],
      }).filter(line => /^(Prompt|Answer):/.test(line)),
      [
        "Prompt: Enter passphrase for key '/k': ",
        'Answer: ***',
        'Prompt: Are you sure you want to continue connecting (yes/no)? ',
        'Answer: ***',
      ],
    );
  });

  it('F-2003.BR-6 item 7: an empty answer is still masked', () => {
    deepStrictEqual(
      linesOf({prompts: [{text: 'Password: ', answer: ''}]}).filter(line =>
        line.startsWith('Answer:'),
      ),
      ['Answer: ***'],
    );
  });

  it('F-2003.BR-6 item 7: no prompt gives no prompt line', () => {
    deepStrictEqual(
      linesOf({prompts: []}).filter(line => /^(Prompt|Answer):/.test(line)),
      [],
    );
  });

  it('F-2003.BR-6 item 8: the remote output is written line by line', () => {
    deepStrictEqual(
      resolveLogLines({
        ...without(recordWith(), 'connectionToken'),
        remoteOutput: ['a', 'b'],
      }).filter(line => line.startsWith('[remote] ')),
      ['[remote] a', '[remote] b'],
    );
  });

  const token = 'Ab1-9z';
  const masks: Array<[string, Partial<ResolveRecord>, string]> = [
    [
      'a setting value',
      {settings: [{name: 'name', value: `x ${token} y`}]},
      'remote.SSH.name = x aa1-1a y',
    ],
    ['an ssh line', {sshLines: [`out ${token}`]}, '[ssh] out aa1-1a'],
    [
      'a prompt text',
      {prompts: [{text: `Code ${token}: `, answer: ''}]},
      'Prompt: Code aa1-1a: ',
    ],
    ['a remote line', {remoteOutput: [`got ${token}`]}, '[remote] got aa1-1a'],
    ['the failure', {failure: `bad ${token}`}, 'Resolution failed: bad aa1-1a'],
    ['a server line', {serverOutput: [`up ${token}`]}, '[server] up aa1-1a'],
    [
      'a summary message',
      {summary: {kind: 'issues', issues: [{status: 'S', message: token}]}},
      '[S]: aa1-1a',
    ],
  ];
  for (const [field, overrides, expected] of masks) {
    it(`F-2003.7.E6: masks the token in ${field}`, () => {
      deepStrictEqual(
        linesOf({
          ...overrides,
          connectionToken: token,
          sshLines: overrides.sshLines ?? [],
        }).filter(line => line.includes(expected)),
        [expected],
      );
    });
  }

  it('F-2003.7.E6: masks every occurrence of the token in one line', () => {
    deepStrictEqual(
      linesOf({
        connectionToken: token,
        remoteOutput: [`${token} and ${token}`],
      }).filter(line => line.startsWith('[remote] ')),
      ['[remote] aa1-1a and aa1-1a'],
    );
  });

  it('F-2003.7.E6: a token holding a replacement pattern is masked as text', () => {
    deepStrictEqual(
      linesOf({
        connectionToken: 'ab$&cd',
        remoteOutput: ['x ab$&cd y'],
      }).filter(line => line.startsWith('[remote] ')),
      ['[remote] x aa$&aa y'],
    );
  });

  it('F-2003.7.E6: an empty token leaves every line unchanged', () => {
    deepStrictEqual(
      linesOf({connectionToken: '', remoteOutput: ['keep ab12-cd34']}).filter(
        line => line.startsWith('[remote] '),
      ),
      ['[remote] keep ab12-cd34'],
    );
  });

  it('F-2003.AC-16 / F-2003.BR-14: neither answer nor token reaches the log', () => {
    const lines = linesOf({
      prompts: [
        {text: 'Password: ', answer: 'p4ss w0rd'},
        {text: "Enter passphrase for key '/k': ", answer: 'hunter2'},
      ],
      connectionToken: 'tok-9f8e7d',
      remoteOutput: ['r tok-9f8e7d'],
      serverOutput: ['s tok-9f8e7d'],
    }).join('\n');
    deepStrictEqual(
      [
        lines.includes('p4ss w0rd'),
        lines.includes('hunter2'),
        lines.includes('tok-9f8e7d'),
        lines.split('Answer: ***').length - 1,
        lines.split('aaa-1a1a1a').length - 1,
      ],
      [false, false, false, 2, 2],
    );
  });

  it('F-2003.AC-21: a token in no line is not written', () => {
    ok(
      !linesOf({
        connectionToken: 'tok-9f8e7d',
        remoteOutput: [],
        serverOutput: [],
      })
        .join('\n')
        .includes('tok-9f8e7d'),
    );
  });

  it('F-2003.BR-6 item 9: the listening port without a resolved port', () => {
    deepStrictEqual(
      resolveLogLines(without(recordWith(), 'resolvedPort')).filter(line =>
        /^(Remote server listening|Resolved)/.test(line),
      ),
      ['Remote server listening on port 40000'],
    );
  });

  it('F-2003.BR-6 item 10: the resolved port without a listening port', () => {
    deepStrictEqual(
      resolveLogLines(without(recordWith(), 'listeningPort')).filter(line =>
        /^(Remote server listening|Resolved)/.test(line),
      ),
      ['Resolved ssh-remote+host1.invalid to local port 50000'],
    );
  });

  it('F-2003.BR-6 item 9: neither port gives neither line', () => {
    deepStrictEqual(
      resolveLogLines(
        without(without(recordWith(), 'listeningPort'), 'resolvedPort'),
      ).filter(line => /^(Remote server listening|Resolved)/.test(line)),
      [],
    );
  });

  it('F-2003.BR-6 item 11: the failure follows the remote lines and precedes the rule', () => {
    const lines = resolveLogLines(
      without(
        without(
          recordWith({failure: 'Could not resolve hostname.'}),
          'listeningPort',
        ),
        'resolvedPort',
      ),
    );
    const index = lines.indexOf(
      'Resolution failed: Could not resolve hostname.',
    );
    deepStrictEqual(
      [lines[index - 1], lines[index + 1]],
      ['[remote] token aa11-aa11 ready', RULE],
    );
  });

  it('F-2003.BR-7: a failure after the listening port keeps both lines in order', () => {
    deepStrictEqual(
      resolveLogLines(
        without(
          recordWith({failure: 'The connection timed out.'}),
          'resolvedPort',
        ),
      ).filter(line =>
        /^(Remote server listening|Resolution failed)/.test(line),
      ),
      [
        'Remote server listening on port 40000',
        'Resolution failed: The connection timed out.',
      ],
    );
  });

  it('F-2003.BR-6 item 12: the rule, four empty lines and the hint notice follow the last entry', () => {
    deepStrictEqual(linesOf().slice(-7, -1), [RULE, ...EMPTY_LINES, NO_HINTS]);
  });

  it('F-2605.6.5: disabled session logs are announced', () => {
    deepStrictEqual(
      linesOf({summary: {kind: 'disabled'}, serverOutput: []}).slice(-5),
      [...EMPTY_LINES, 'Enhanced session logs are disabled.'],
    );
  });

  const offline = {
    status: 'OfflineError',
    message: 'Error: OfflineError (The connection timed out)',
  };

  it('F-2003.AC-23: the session summary lists its issue between the heading and a rule', () => {
    deepStrictEqual(
      linesOf({
        summary: {kind: 'issues', issues: [offline]},
        serverOutput: [],
      }).slice(-8),
      [
        RULE,
        ...EMPTY_LINES,
        '---------- [Session Summary] ----------',
        '[OfflineError]: Error: OfflineError (The connection timed out)',
        RULE,
      ],
    );
  });

  it('F-2605.BR-6: issues are written in the given order', () => {
    deepStrictEqual(
      linesOf({
        summary: {
          kind: 'issues',
          issues: [offline, {status: 'Second', message: 'two'}],
        },
        serverOutput: [],
      }).slice(-4),
      [
        '---------- [Session Summary] ----------',
        '[OfflineError]: Error: OfflineError (The connection timed out)',
        '[Second]: two',
        RULE,
      ],
    );
  });

  it('F-2605.AC-26: no issue leaves the heading beside the closing rule', () => {
    deepStrictEqual(
      linesOf({
        summary: {kind: 'issues', issues: []},
        serverOutput: [],
      }).slice(-2),
      ['---------- [Session Summary] ----------', RULE],
    );
  });

  it('F-2003.AC-23: a failed resolve ends with its summary and nothing after the closing rule', () => {
    deepStrictEqual(
      resolveLogLines(
        without(
          without(
            recordWith({
              failure: 'The connection timed out.',
              summary: {kind: 'issues', issues: [offline]},
              serverOutput: [],
            }),
            'listeningPort',
          ),
          'resolvedPort',
        ),
      ).slice(-9),
      [
        'Resolution failed: The connection timed out.',
        RULE,
        ...EMPTY_LINES,
        '---------- [Session Summary] ----------',
        '[OfflineError]: Error: OfflineError (The connection timed out)',
        RULE,
      ],
    );
  });

  it('F-2003.BR-6 item 13: the server output follows the summary', () => {
    deepStrictEqual(linesOf({serverOutput: ['a', 'b']}).slice(-3), [
      NO_HINTS,
      '[server] a',
      '[server] b',
    ]);
  });

  it('F-2003.BR-6 item 13: no server output ends the log with the summary', () => {
    deepStrictEqual(linesOf({serverOutput: []}).at(-1), NO_HINTS);
  });

  it('F-2003.BR-4: no line starts with a time', () => {
    deepStrictEqual(
      linesOf().filter(line => /^\[\d/.test(line)),
      [],
    );
  });

  it('F-2003.BR-6: a frozen record gives the same lines twice', () => {
    const record = recordWith();
    for (const list of [
      record.settings,
      record.sshLines,
      record.prompts,
      record.remoteOutput,
      record.serverOutput,
    ]) {
      Object.freeze(list);
    }
    Object.freeze(record);
    deepStrictEqual(resolveLogLines(record), resolveLogLines(record));
  });

  describe('follow-ups (card connect-12)', () => {
    it('F-2003.BR-6 item 7 (O3): a prompt without an answer is marked', () => {
      deepStrictEqual(
        linesOf({prompts: [{text: 'Password: '}]}).filter(line =>
          /^(Prompt|Answer):/.test(line),
        ),
        ['Prompt: Password: ', 'Answer: (none)'],
      );
    });

    it('F-2003.BR-6 item 7 (O3): answered and unanswered prompts are told apart', () => {
      deepStrictEqual(
        linesOf({
          prompts: [{text: 'a: ', answer: 'x'}, {text: 'b: '}],
        }).filter(line => /^(Prompt|Answer):/.test(line)),
        ['Prompt: a: ', 'Answer: ***', 'Prompt: b: ', 'Answer: (none)'],
      );
    });

    it('F-2003.BR-6 item 7 (O3): an empty answer is still masked', () => {
      deepStrictEqual(
        linesOf({prompts: [{text: 'Password: ', answer: ''}]}).filter(line =>
          /^(Prompt|Answer):/.test(line),
        ),
        ['Prompt: Password: ', 'Answer: ***'],
      );
    });

    function remoteLines(remoteOutput: string[], token?: string): string[] {
      const base = recordWith({remoteOutput});
      const record =
        token === undefined
          ? without(base, 'connectionToken')
          : {...base, connectionToken: token};
      return resolveLogLines(record).filter(line =>
        line.startsWith('[remote] '),
      );
    }

    it('F-2003.BR-4 (O5): a remote entry is split at a line feed', () => {
      deepStrictEqual(remoteLines(['one\ntwo']), [
        '[remote] one',
        '[remote] two',
      ]);
    });

    it('F-2003.BR-4 (O5): a server entry is split at every kind of line break', () => {
      deepStrictEqual(
        linesOf({serverOutput: ['a\r\nb\rc']}).filter(line =>
          line.startsWith('[server] '),
        ),
        ['[server] a', '[server] b', '[server] c'],
      );
    });

    it('F-2003.BR-4 (O5): empty parts are dropped', () => {
      deepStrictEqual(remoteLines(['x\n\ny\n']), ['[remote] x', '[remote] y']);
    });

    it('F-2003.BR-4 (O5): an entry of line breaks only gives no line', () => {
      deepStrictEqual(remoteLines(['\n']), []);
    });

    it('F-2003.BR-4 (O5): the token is masked in every part', () => {
      deepStrictEqual(
        remoteLines(['token ab12-cd34\nagain ab12-cd34'], 'ab12-cd34'),
        ['[remote] token aa11-aa11', '[remote] again aa11-aa11'],
      );
    });

    it('F-2003.BR-4 (O5): at debug level a debug1 part of a multi-line entry is dropped', () => {
      deepStrictEqual(
        linesOf({
          level: 'debug',
          sshLines: ['real error\ndebug1: noise'],
        }).filter(line => line.startsWith('[ssh] ')),
        ['[ssh] real error'],
      );
    });

    it('F-2003.BR-4 (O5): at trace level every part is kept', () => {
      deepStrictEqual(
        linesOf({
          level: 'trace',
          sshLines: ['real error\ndebug1: noise'],
        }).filter(line => line.startsWith('[ssh] ')),
        ['[ssh] real error', '[ssh] debug1: noise'],
      );
    });

    it('F-2003.BR-4: every kind of line break in the failure becomes a space', () => {
      deepStrictEqual(
        linesOf({failure: 'first\nsecond\r\nthird\rfourth'}).filter(line =>
          line.startsWith('Resolution failed:'),
        ),
        ['Resolution failed: first second third fourth'],
      );
    });

    it('F-2003.BR-4: line breaks in the failure are not collapsed', () => {
      deepStrictEqual(
        linesOf({failure: 'a\n\nb'}).filter(line =>
          line.startsWith('Resolution failed:'),
        ),
        ['Resolution failed: a  b'],
      );
    });

    it('F-2003.BR-4: the token is masked in a failure of several lines', () => {
      deepStrictEqual(
        linesOf({
          failure: 'x ab12-cd34\ny',
          connectionToken: 'ab12-cd34',
        }).filter(line => line.startsWith('Resolution failed:')),
        ['Resolution failed: x aa11-aa11 y'],
      );
    });

    it('F-2003.BR-4: a line break in a summary message becomes a space', () => {
      deepStrictEqual(
        linesOf({
          summary: {
            kind: 'issues',
            issues: [{status: 'E', message: 'a\rb'}],
          },
        }).filter(line => line.startsWith('[E]:')),
        ['[E]: a b'],
      );
    });
  });
});

describe('the lines of the client search and the probed platform (card connect-28)', () => {
  it('F-2101 §9: the setting is shown as JSON text', () => {
    deepStrictEqual(
      [pathSettingLine(''), pathSettingLine('/opt/a "b"/ssh')],
      ['remote.SSH.path = ""', 'remote.SSH.path = "/opt/a \\"b\\"/ssh"'],
    );
  });

  it('F-2101 §9: a check, its banner, a rejection and a use each have their line', () => {
    deepStrictEqual(
      [
        checkingLine('ssh'),
        bannerLine('OpenSSH_9.6p1'),
        rejectedLine('ssh', 'exit status 1'),
        notValidLine('/x/ssh'),
        usingLine('ssh'),
      ],
      [
        'Checking ssh client: ssh',
        'ssh client: OpenSSH_9.6p1',
        'ssh client ssh was rejected: exit status 1',
        'remote.SSH.path "/x/ssh" is not a valid SSH binary',
        'Using ssh client: ssh',
      ],
    );
  });

  it('F-2201 §9: the configuration file in use has its line', () => {
    deepStrictEqual(
      configFileLine('/home/a/cfg'),
      'SSH configuration file in use: /home/a/cfg',
    );
  });

  it('F-2101 §9: each folder of the search path is a line, in order', () => {
    deepStrictEqual(searchedLines(['/b', '/a']), [
      'Searched for ssh in: /b',
      'Searched for ssh in: /a',
    ]);
  });

  it('F-2101 §9: no folder is no line', () => {
    deepStrictEqual(searchedLines([]), []);
  });

  it('F-2206 §9: the host platform is its system and architecture', () => {
    deepStrictEqual(
      hostPlatformLine({operatingSystem: 'linux', architecture: 'arm64'}),
      'Host platform: linux arm64',
    );
  });
});

describe('the server result and the progress in the log (card connect-67)', () => {
  /** A parsed block with `facts`, as lib-server gives it. */
  function parsedBlock(
    facts: Partial<Pick<ResultBlock, 'hostFacts' | 'serverFacts' | 'timings'>>,
  ): ResultBlock {
    return {
      status: 'Ok',
      hostFacts: {},
      serverFacts: {},
      cliFacts: {},
      timings: {},
      ...facts,
    };
  }

  it('F-2003 BR-6 item 8: the result is logged as one summary line from the parsed block', () => {
    deepStrictEqual(
      serverResultLine(
        parsedBlock({
          hostFacts: {os: 'linux', arch: 'x64', display: ':10'},
          serverFacts: {port: '41234', token: 'secret'},
          timings: {download: 1200, install: 800, start: 90},
        }),
      ),
      'Server result: Ok, port 41234, os linux, architecture x64, download 1200 ms, install 800 ms',
    );
  });

  it('F-2003 BR-14: the summary has only the parts the block has, and no other fact', () => {
    deepStrictEqual(
      serverResultLine(parsedBlock({hostFacts: {sshAuthSock: '/tmp/a'}})),
      'Server result: Ok',
    );
  });
});
