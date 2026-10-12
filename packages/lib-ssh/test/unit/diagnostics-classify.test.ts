import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  classify,
  endWithFullStop,
  isDebugLine,
  logLinesOf,
} from '../../src/index.ts';
import type {
  ClassifyPurpose,
  Classification,
  ConnectionMode,
  DiagnosticStringId,
  FailureHint,
} from '../../src/index.ts';

/** The warning line that names a changed host key. */
const CHANGED_KEY_LINE =
  '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@';

/** The line that names a client-disabled port forwarding. */
const MITM_FORWARDING_LINE =
  'Warning: Port forwarding is disabled to avoid man-in-the-middle attacks.';

/** The line that names a server-prohibited forwarding. */
const PROHIBITED_LINE =
  'channel 2: open failed: administratively prohibited: open failed';

/** The hint an offline text carries, the row's OFF(id) notation. */
function offlineHint(reasonId: DiagnosticStringId): FailureHint {
  return {
    status: 'OfflineError',
    message: 'Error: OfflineError',
    details: {id: reasonId},
    mitigations: [],
    resources: [],
  };
}

/** The classification of one offline text: the kind, the reason and its hint. */
function offline(
  kind: Classification['kind'],
  reasonId: DiagnosticStringId,
): Classification {
  return {
    kind,
    reason: {id: reasonId},
    hints: [offlineHint(reasonId)],
    logLines: [],
  };
}

/** The classification of a denied line: kind, reason and hint named by the text. */
function denied(text: string): Classification {
  return {
    kind: 'authentication',
    reason: {text},
    hints: [
      {
        status: 'PermissionDenied',
        message: 'Error: PermissionDenied',
        details: {text},
        mitigations: [],
        resources: [],
      },
    ],
    logLines: [],
  };
}

/** The recorded rows of the fixture, in file order. */
function recordedRows(): Array<{
  source: string;
  errorLines: string[];
  exitStatus: number;
}> {
  return JSON.parse(
    readFileSync(
      new URL('../fixtures/stderr/recorded.json', import.meta.url),
      'utf8',
    ),
  ) as Array<{source: string; errorLines: string[]; exitStatus: number}>;
}

/** One run with the row's lines, or the defaults the row leaves. */
function classifyRun(
  errorLines: readonly string[],
  exitStatus: number | undefined,
  purpose: ClassifyPurpose,
  mode: ConnectionMode,
): Classification {
  return classify(errorLines, exitStatus, purpose, mode);
}

/** The classification of a server-prohibited channel line. */
function prohibitedResult(): Classification {
  return {
    kind: 'forwardingDisabled',
    hints: [
      {
        status: 'AllowTcpForwardingDisabled',
        message: {id: 'S150', values: []},
        mitigations: [
          {
            id: 'S005',
            values: ['AllowTcpForwarding yes', '/etc/ssh/sshd_config'],
          },
          {id: 'S116', values: []},
        ],
        resources: ['hangingOrFailingConnections'],
      },
    ],
    logLines: ['S046'],
  };
}

/** The classification of a client-disabled forwarding line in terminal mode. */
function mitmResult(): Classification {
  return {
    kind: 'forwardingDisabled',
    reason: {id: 'S107'},
    hints: [
      {
        status: 'MitmPortForwardingDisabled',
        message: 'Error: MitmPortForwardingDisabled',
        details: {id: 'S107'},
        mitigations: [],
        resources: [],
      },
    ],
    logLines: [],
  };
}

const SEVEN_TEXTS = [
  'Network is unreachable',
  'Could not resolve hostname',
  'The process tried to write to a nonexistent pipe',
  'Connection timed out',
  'Operation timed out',
  'No route to host',
  "Can't assign requested address",
] as const;

describe('classify (the kind, reason and hints of one failed run)', () => {
  it('F-2603.BR-3: an unreachable network names its reason', () => {
    deepStrictEqual(
      classifyRun(
        ['ssh: connect to host 192.0.2.1 port 22: Network is unreachable'],
        255,
        'connection',
        'shared',
      ),
      offline('unreachable', 'S094'),
    );
  });

  it('F-2603.BR-3: an unresolvable hostname names its reason', () => {
    deepStrictEqual(
      classifyRun(
        [
          'ssh: Could not resolve hostname nosuch.invalid: Name or service not known',
        ],
        255,
        'connection',
        'shared',
      ),
      offline('unreachable', 'S032'),
    );
  });

  it('F-2603.BR-3: a nonexistent pipe names its reason', () => {
    deepStrictEqual(
      classifyRun(
        [
          'ssh: connect to host h port 22: The process tried to write to a nonexistent pipe',
        ],
        255,
        'connection',
        'shared',
      ),
      offline('unreachable', 'S142'),
    );
  });

  it('F-2105.BR-10: a connection timeout names its reason', () => {
    deepStrictEqual(
      classifyRun(
        ['ssh: connect to host 192.0.2.1 port 22: Connection timed out'],
        255,
        'connection',
        'shared',
      ),
      offline('timeout', 'S137'),
    );
  });

  it('F-2105.BR-10: an operation timeout names its reason', () => {
    deepStrictEqual(
      classifyRun(
        ['ssh: connect to host 192.0.2.1 port 22: Operation timed out'],
        255,
        'connection',
        'shared',
      ),
      offline('timeout', 'S140'),
    );
  });

  it('F-2603.BR-3: a missing route names its reason', () => {
    deepStrictEqual(
      classifyRun(
        ['ssh: connect to host h port 22: No route to host'],
        255,
        'connection',
        'shared',
      ),
      offline('unreachable', 'S097'),
    );
  });

  it('F-2603.BR-3: an unassignable address names its reason', () => {
    deepStrictEqual(
      classifyRun(
        ["ssh: connect to host h port 22: Can't assign requested address"],
        255,
        'connection',
        'shared',
      ),
      offline('unreachable', 'S014'),
    );
  });

  it('F-2603.BR-1: the text is recognised at any position in the line', () => {
    deepStrictEqual(
      classifyRun(
        ['prefix Network is unreachable suffix'],
        255,
        'connection',
        'shared',
      ),
      offline('unreachable', 'S094'),
    );
  });

  const PAIRS: Array<[string, string, string, string]> = [
    [
      'Network is unreachable',
      'Could not resolve hostname',
      'S094',
      'unreachability before an unresolvable hostname',
    ],
    [
      'Network is unreachable',
      'No route to host',
      'S094',
      'unreachability before a missing route',
    ],
    [
      'Could not resolve hostname',
      'The process tried to write to a nonexistent pipe',
      'S032',
      'an unresolvable hostname before the pipe text',
    ],
    [
      'The process tried to write to a nonexistent pipe',
      'Connection timed out',
      'S142',
      'the pipe text before a connection timeout',
    ],
    [
      'Connection timed out',
      'No route to host',
      'S137',
      'a connection timeout before a missing route',
    ],
    [
      'Connection timed out',
      'Operation timed out',
      'S137',
      'a connection timeout before an operation timeout',
    ],
    [
      'Operation timed out',
      'No route to host',
      'S140',
      'an operation timeout before a missing route',
    ],
    [
      'No route to host',
      "Can't assign requested address",
      'S097',
      'a missing route before an unassignable address',
    ],
  ];
  for (const [first, second, reason, label] of PAIRS) {
    it(`F-2603.7.E2: ${label}, in either line order`, () => {
      deepStrictEqual(
        [
          classifyRun([first, second], 255, 'connection', 'shared').reason,
          classifyRun([second, first], 255, 'connection', 'shared').reason,
        ],
        [{id: reason}, {id: reason}],
      );
    });
  }

  it('F-2603.7.E2: all seven texts in table order give the first reason', () => {
    deepStrictEqual(
      classifyRun([...SEVEN_TEXTS], 255, 'connection', 'shared').reason,
      {id: 'S094'},
    );
  });

  it('F-2603.7.E2: all seven texts in reverse order give the first reason', () => {
    deepStrictEqual(
      classifyRun([...SEVEN_TEXTS].reverse(), 255, 'connection', 'shared')
        .reason,
      {id: 'S094'},
    );
  });

  const CASE_VARIANTS = [
    'network is unreachable',
    'no route to host',
    'Cannot assign requested address',
    'Connection refused',
    'Host is down',
  ] as const;
  for (const variant of CASE_VARIANTS) {
    it(`F-2603.7.E1: the text ${variant} matches nothing`, () => {
      deepStrictEqual(classifyRun([variant], 255, 'connection', 'shared'), {
        kind: 'unknown',
        hints: [],
        logLines: [],
      });
    });
  }

  it('F-2603.BR-1: a resolve line without the word name matches nothing', () => {
    deepStrictEqual(
      classifyRun(
        ['ssh: Could not resolve host x'],
        255,
        'connection',
        'shared',
      ),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('F-2205.BR-6 / F-2205.9: an invalid host name on a connection names its reason', () => {
    deepStrictEqual(
      classifyRun(
        ['ssh: hostname contains invalid characters'],
        255,
        'connection',
        'shared',
      ),
      {
        kind: 'unreachable',
        reason: {id: 'S079'},
        hints: [
          {
            status: 'InvalidHostName',
            message: 'Error: InvalidHostName',
            details: {id: 'S079'},
            mitigations: [],
            resources: [],
          },
        ],
        logLines: [],
      },
    );
  });

  const OTHER_PURPOSES: ClassifyPurpose[] = ['oneShot', 'tunnel', 'copy'];
  for (const purpose of OTHER_PURPOSES) {
    it(`F-2205.BR-6: the same line on purpose ${purpose} matches nothing`, () => {
      deepStrictEqual(
        classifyRun(
          ['ssh: hostname contains invalid characters'],
          255,
          purpose,
          'shared',
        ),
        {kind: 'unknown', hints: [], logLines: []},
      );
    });
  }

  it('F-2306.BR-13: the last denied line, without its prefix', () => {
    deepStrictEqual(
      classifyRun(
        ['debug1: x', 'lab@127.0.0.1: Permission denied (publickey,password).'],
        255,
        'connection',
        'shared',
      ),
      denied('Permission denied (publickey,password).'),
    );
  });

  it('F-2306.BR-13: trailing blanks of the denied line', () => {
    deepStrictEqual(
      classifyRun(
        [
          'Permission denied, please try again.',
          'x@h: Permission denied (password).  ',
        ],
        255,
        'connection',
        'shared',
      ),
      denied('Permission denied (password).'),
    );
  });

  it('F-2201 AC-35: a config file ssh cannot read gives Permission denied', () => {
    deepStrictEqual(
      classifyRun(
        ["Can't open user config file /home/a/cfg: Permission denied"],
        255,
        'connection',
        'shared',
      ),
      {
        kind: 'unknown',
        reason: {text: 'Permission denied'},
        hints: [],
        logLines: [],
      },
    );
  });

  it('F-2201 AC-35: the config-file line wins over a following denied line', () => {
    deepStrictEqual(
      classifyRun(
        [
          "Can't open user config file /home/a/cfg: Permission denied",
          'Permission denied (publickey).',
        ],
        255,
        'connection',
        'shared',
      ),
      {
        kind: 'unknown',
        reason: {text: 'Permission denied'},
        hints: [],
        logLines: [],
      },
    );
  });

  it('F-2201 7.E8: a config file that is missing keeps no reason', () => {
    deepStrictEqual(
      classifyRun(
        ["Can't open user config file /home/a/cfg: No such file or directory"],
        255,
        'connection',
        'shared',
      ),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('F-2603 BR-10: a denied line that is not a config file stays an authentication', () => {
    deepStrictEqual(
      classifyRun(
        ['a@h: Permission denied (password).'],
        255,
        'connection',
        'shared',
      ),
      denied('Permission denied (password).'),
    );
  });

  it('F-2306.BR-13: the later denied line wins', () => {
    deepStrictEqual(
      classifyRun(
        [
          'x@h: Permission denied (publickey).',
          'x@h: Permission denied (password).',
        ],
        255,
        'connection',
        'shared',
      ),
      denied('Permission denied (password).'),
    );
  });

  it('F-2306.BR-13: a denied line without a prefix', () => {
    deepStrictEqual(
      classifyRun(
        ['Permission denied (keyboard-interactive).'],
        255,
        'connection',
        'shared',
      ),
      denied('Permission denied (keyboard-interactive).'),
    );
  });

  it('F-2306.BR-13: a please-try-again line alone matches nothing', () => {
    deepStrictEqual(
      classifyRun(
        ['Permission denied, please try again.'],
        255,
        'connection',
        'shared',
      ),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('F-2305.AC-16: a changed key in shared mode', () => {
    deepStrictEqual(
      classifyRun(
        [CHANGED_KEY_LINE, 'Host key verification failed.'],
        255,
        'connection',
        'shared',
      ),
      {kind: 'hostKeyChanged', reason: {id: 'S111'}, hints: [], logLines: []},
    );
  });

  it('F-2305.AC-18: the same lines in terminal mode', () => {
    deepStrictEqual(
      classifyRun(
        [CHANGED_KEY_LINE, 'Host key verification failed.'],
        255,
        'connection',
        'terminal',
      ),
      {kind: 'hostKeyRejected', hints: [], logLines: []},
    );
  });

  it('F-2305.BR-6: the changed key line alone in shared mode', () => {
    deepStrictEqual(
      classifyRun([CHANGED_KEY_LINE], 255, 'connection', 'shared'),
      {kind: 'hostKeyChanged', reason: {id: 'S111'}, hints: [], logLines: []},
    );
  });

  it('F-2305.BR-6: the changed key line alone in terminal mode', () => {
    deepStrictEqual(
      classifyRun([CHANGED_KEY_LINE], 255, 'connection', 'terminal'),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  const HOST_KEY_MODES: ConnectionMode[] = ['shared', 'terminal'];
  for (const mode of HOST_KEY_MODES) {
    it(`F-2305.AC-21: a rejected key in mode ${mode}`, () => {
      deepStrictEqual(
        classifyRun(['Host key verification failed.'], 255, 'connection', mode),
        {kind: 'hostKeyRejected', hints: [], logLines: []},
      );
    });
  }

  it('F-2604.BR-1: a prohibited channel names the server setting', () => {
    deepStrictEqual(
      classifyRun([PROHIBITED_LINE], 255, 'connection', 'shared'),
      prohibitedResult(),
    );
  });

  it('F-2604.AC-11: the same line in terminal mode', () => {
    deepStrictEqual(
      classifyRun([PROHIBITED_LINE], 255, 'connection', 'terminal'),
      classifyRun([PROHIBITED_LINE], 255, 'connection', 'shared'),
    );
  });

  it('F-2604.BR-2: the line three times gives one hint and one log line', () => {
    deepStrictEqual(
      classifyRun(
        [
          'channel 2: open failed: administratively prohibited: open failed',
          'channel 3: open failed: administratively prohibited: open failed',
          'channel 4: open failed: administratively prohibited: open failed',
        ],
        255,
        'connection',
        'shared',
      ),
      prohibitedResult(),
    );
  });

  it('F-2604.BR-6: a client-disabled forwarding in terminal mode', () => {
    deepStrictEqual(
      classifyRun([MITM_FORWARDING_LINE], 255, 'connection', 'terminal'),
      mitmResult(),
    );
  });

  it('F-2604.BR-6: the same line in shared mode matches nothing', () => {
    deepStrictEqual(
      classifyRun([MITM_FORWARDING_LINE], 255, 'connection', 'shared'),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('F-2305.AC-19: a changed key then a client-disabled forwarding in terminal mode', () => {
    deepStrictEqual(
      classifyRun(
        [CHANGED_KEY_LINE, MITM_FORWARDING_LINE],
        255,
        'connection',
        'terminal',
      ),
      mitmResult(),
    );
  });

  it('F-2603.7.E3: a broken pipe on the last write', () => {
    deepStrictEqual(
      classifyRun(
        [
          'packet_write_wait: Connection to x port 22: send disconnect: Broken pipe',
        ],
        255,
        'connection',
        'shared',
      ),
      {
        kind: 'brokenPipe',
        hints: [
          {
            status: 'SendDisconnectBrokenPipe',
            message: 'Error: SendDisconnectBrokenPipe',
            mitigations: [],
            resources: [],
          },
        ],
        logLines: [],
      },
    );
  });

  it('F-2603.7.E3: the Windows pipe text is an unreachability', () => {
    deepStrictEqual(
      classifyRun(
        [
          'ssh: connect to host h port 22: The process tried to write to a nonexistent pipe',
        ],
        255,
        'connection',
        'shared',
      ),
      offline('unreachable', 'S142'),
    );
  });

  const EMPTY_STATUSES: Array<[string, number | undefined]> = [
    ['255', 255],
    ['0', 0],
    ['undefined', undefined],
  ];
  for (const [label, status] of EMPTY_STATUSES) {
    it(`F-2105.BR-10: no lines with an exit status of ${label}`, () => {
      deepStrictEqual(classifyRun([], status, 'connection', 'shared'), {
        kind: 'unknown',
        hints: [],
        logLines: [],
      });
    });
  }

  it('F-2109.BR-5: lines that match no text', () => {
    deepStrictEqual(
      classifyRun(['debug1: x', 'Notice: y'], 255, 'connection', 'shared'),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('S5 contract: prompt lines never reach the result', () => {
    const result = classifyRun(
      [
        "Enter passphrase for key '/home/dev/.ssh/id_x': ",
        'Password: hunter2',
        'Network is unreachable',
      ],
      255,
      'connection',
      'shared',
    );
    deepStrictEqual(
      [
        result.kind,
        result.reason,
        JSON.stringify(result).includes('hunter2'),
        JSON.stringify(result).includes('/home/dev'),
      ],
      ['unreachable', {id: 'S094'}, false, false],
    );
  });

  it('S5 contract: two prompt lines alone match nothing', () => {
    const result = classifyRun(
      ["Enter passphrase for key '/home/dev/.ssh/id_x': ", 'Password: hunter2'],
      255,
      'connection',
      'shared',
    );
    deepStrictEqual(
      [
        result.kind,
        JSON.stringify(result).includes('hunter2'),
        JSON.stringify(result).includes('/home/dev'),
      ],
      ['unknown', false, false],
    );
  });

  it('F-2603.BR-1: the recorded rows classify as their matching text', () => {
    deepStrictEqual(
      recordedRows().map(recorded =>
        classifyRun(
          recorded.errorLines,
          recorded.exitStatus,
          'connection',
          'shared',
        ),
      ),
      [
        offline('unreachable', 'S032'),
        {kind: 'unknown', hints: [], logLines: []},
        offline('timeout', 'S140'),
      ],
    );
  });

  it('F-2604.7.E1: a closed channel', () => {
    deepStrictEqual(
      classifyRun(['Connection closed.'], 255, 'connection', 'shared'),
      {
        kind: 'channelClosed',
        reason: {text: 'Connection closed.'},
        hints: [],
        logLines: [],
      },
    );
  });

  it('F-2604.BR-1: a failed channel open matches nothing', () => {
    deepStrictEqual(
      classifyRun(
        ['channel 3: open failed: connect failed: open failed'],
        255,
        'connection',
        'shared',
      ),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('F-2604.7.E1: a closed connection by the host matches nothing', () => {
    deepStrictEqual(
      classifyRun(
        ['Connection closed by 192.0.2.1 port 22'],
        255,
        'connection',
        'shared',
      ),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('F-2605.6.2: a denied password', () => {
    deepStrictEqual(
      classifyRun(
        ['x@h.invalid: Permission denied (password).'],
        255,
        'connection',
        'shared',
      ),
      denied('Permission denied (password).'),
    );
  });

  it('F-2601.5.0: a rejected host key', () => {
    deepStrictEqual(
      classifyRun(
        ['Host key verification failed.'],
        255,
        'connection',
        'shared',
      ),
      {kind: 'hostKeyRejected', hints: [], logLines: []},
    );
  });

  it('F-2305.BR-6: a changed key then a client-disabled forwarding in shared mode', () => {
    deepStrictEqual(
      classifyRun(
        [CHANGED_KEY_LINE, MITM_FORWARDING_LINE],
        255,
        'connection',
        'shared',
      ),
      {kind: 'unknown', hints: [], logLines: []},
    );
  });

  it('F-2109.BR-4: the log lines keep only the server host key of the debug lines', () => {
    deepStrictEqual(
      logLinesOf([
        'debug1: Server host key: ssh-ed25519 SHA256:abc',
        'debug1: Authenticating to h.invalid:22',
        'debug2: x',
        'Warning: y',
      ]),
      [
        'debug1: Server host key: ssh-ed25519 SHA256:abc',
        'debug2: x',
        'Warning: y',
      ],
    );
  });

  it('F-2109.BR-4: a scp line before an ssh debug line is dropped too, the host key stays', () => {
    deepStrictEqual(
      logLinesOf(['scp: debug1: x', 'debug1: Server host key: k', 'debug2: y']),
      ['debug1: Server host key: k', 'debug2: y'],
    );
  });

  it('F-2109.BR-4: no lines give no log lines', () => {
    deepStrictEqual(logLinesOf([]), []);
  });

  it('F-2603.BR-3 (provisional): a denied line wins over a missing route', () => {
    deepStrictEqual(
      classifyRun(
        ['x@h.invalid: Permission denied (publickey).', 'No route to host'],
        255,
        'connection',
        'shared',
      ),
      denied('Permission denied (publickey).'),
    );
  });

  it('F-2604.AC-3 (provisional): the forwarding hint names its documentation topic', () => {
    const result = classifyRun([PROHIBITED_LINE], 255, 'connection', 'shared');
    deepStrictEqual(result.hints[0]?.resources, [
      'hangingOrFailingConnections',
    ]);
  });

  const REJECTED_STATUSES: Array<[string, number | undefined]> = [
    ['0', 0],
    ['undefined', undefined],
  ];
  for (const [label, status] of REJECTED_STATUSES) {
    it(`F-2604.BR-3 (provisional): a rejected key with an exit status of ${label}`, () => {
      deepStrictEqual(
        classifyRun(
          ['Host key verification failed.'],
          status,
          'connection',
          'shared',
        ),
        {kind: 'hostKeyRejected', hints: [], logLines: []},
      );
    });
  }

  it('F-2604.BR-3 (provisional): a rejected key with the default exit status', () => {
    deepStrictEqual(
      classifyRun(
        ['Host key verification failed.'],
        255,
        'connection',
        'shared',
      ),
      {kind: 'hostKeyRejected', hints: [], logLines: []},
    );
  });

  it('F-2305.BR-6 (provisional): the changed key line alone carries no hints', () => {
    deepStrictEqual(
      classifyRun([CHANGED_KEY_LINE], 255, 'connection', 'shared').hints,
      [],
    );
  });
});

describe('isDebugLine (the one debug-line rule, F-2109 BR-4)', () => {
  it('F-2109 BR-4: a line that starts with debug1: is one', () => {
    deepStrictEqual(isDebugLine('debug1: a'), true);
  });

  it('F-2109 BR-4: a line that starts with scp: debug1: is one', () => {
    deepStrictEqual(isDebugLine('scp: debug1: a'), true);
  });

  it('F-2109 BR-4: a line that starts with debug2: is not one', () => {
    deepStrictEqual(isDebugLine('debug2: a'), false);
  });

  it('F-2109 BR-4: a line that starts with debug3: is not one', () => {
    deepStrictEqual(isDebugLine('debug3: a'), false);
  });

  it('F-2109 BR-4: a line that says scp: dest open is not one', () => {
    deepStrictEqual(isDebugLine('scp: dest open'), false);
  });

  it('F-2109 BR-4: a line that says Warning: y is not one', () => {
    deepStrictEqual(isDebugLine('Warning: y'), false);
  });
});

describe('endWithFullStop (the closing full stop of a reason text)', () => {
  it('F-2603.BR-10: The connection timed out gains a full stop', () => {
    strictEqual(
      endWithFullStop('The connection timed out'),
      'The connection timed out.',
    );
  });

  it('F-2603.BR-10: Permission denied (password) gains a full stop', () => {
    strictEqual(
      endWithFullStop('Permission denied (password)'),
      'Permission denied (password).',
    );
  });

  const ENDINGS = [
    'Der Hostname konnte nicht aufgelöst werden.',
    'Really?',
    'Wow!',
    '日本語。',
    'x．',
    'x！',
    'x？',
  ] as const;
  for (const ending of ENDINGS) {
    it(`F-2603.BR-10: the text ending ${ending.slice(-1)} keeps its ending`, () => {
      strictEqual(endWithFullStop(ending), ending);
    });
  }
});
