import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {expandHome, TUNNEL_COMMAND} from '../../src/arguments/invocation.ts';
import {buildInvocation, buildOptionsQuery} from '../../src/index.ts';
import type {
  ClientPlatform,
  CopyRequest,
  CopyRunRequest,
  EffectiveOptions,
  Forward,
  Invocation,
  InvocationSettings,
  OptionsQueryRequest,
  SshPurpose,
  SshRequest,
  SshTarget,
} from '../../src/index.ts';

/** What a row changes of the base row. */
interface RequestChanges {
  purpose?: SshPurpose;
  target?: SshTarget;
  platform?: ClientPlatform;
  homeFolder?: string;
  configFile?: string;
  connectTimeout?: number;
  permitPtyAllocation?: unknown;
  remoteCommandInEffect?: boolean;
  effective?: Partial<EffectiveOptions>;
  forwards?: Forward[];
  remoteProgram?: string;
  clearUserForwards?: boolean;
}

/** The options `ssh -G` prints for the host, as the row sets them. */
function baseOptions(changes: Partial<EffectiveOptions>): EffectiveOptions {
  const options: EffectiveOptions = {
    hostName: 'h.invalid',
    user: 'dev',
    port: '22',
    localForwards: [],
    clearAllForwardings: false,
  };
  if (changes.port !== undefined) {
    options.port = changes.port;
  }
  if (changes.connectTimeout !== undefined) {
    options.connectTimeout = changes.connectTimeout;
  }
  if (changes.remoteCommand !== undefined) {
    options.remoteCommand = changes.remoteCommand;
  }
  return options;
}

/** The settings of the base row. */
function baseSettings(changes: RequestChanges): InvocationSettings {
  return {
    configFile: changes.configFile ?? '',
    connectTimeout: changes.connectTimeout ?? 15,
    permitPtyAllocation: changes.permitPtyAllocation ?? false,
    remoteCommandInEffect: changes.remoteCommandInEffect ?? false,
  };
}

/** An `ssh` run of the base row; a row only changes what it names. */
function makeRequest(changes: RequestChanges = {}): SshRequest {
  const request: SshRequest = {
    purpose: changes.purpose ?? 'connection',
    target: changes.target ?? {host: 'alias'},
    settings: baseSettings(changes),
    effective: baseOptions(changes.effective ?? {}),
    programs: {sshProgram: '/x/ssh', scpProgram: '/x/scp'},
    homeFolder: changes.homeFolder ?? '/home/dev',
    platform: changes.platform ?? 'linux',
  };
  if (changes.remoteProgram !== undefined) {
    request.remoteProgram = changes.remoteProgram;
  }
  if (changes.forwards !== undefined) {
    request.forwards = changes.forwards;
  }
  if (changes.clearUserForwards !== undefined) {
    request.clearUserForwards = changes.clearUserForwards;
  }
  return request;
}

/** An `scp` run of the base row; a row only changes what it names. */
function makeCopyRequest(
  changes: {
    target?: SshTarget;
    configFile?: string;
    platform?: ClientPlatform;
    homeFolder?: string;
    copy?: CopyRequest;
  } = {},
): CopyRunRequest {
  return {
    purpose: 'copy',
    target: changes.target ?? {host: 'alias'},
    settings: baseSettings(changes),
    effective: baseOptions({}),
    programs: {sshProgram: '/x/ssh', scpProgram: '/x/scp'},
    homeFolder: changes.homeFolder ?? '/home/dev',
    platform: changes.platform ?? 'linux',
    copy: changes.copy ?? {
      localFile: '/tmp/boot.sh',
      remotePath: '/tmp/x/boot.sh',
    },
  };
}

/** The `ssh -G` run of the base row; a row only changes what it names. */
function makeQuery(
  changes: {
    target?: SshTarget;
    configFile?: string;
    sshProgram?: string;
    homeFolder?: string;
    platform?: ClientPlatform;
  } = {},
): OptionsQueryRequest {
  return {
    target: changes.target ?? {host: 'alias'},
    configFile: changes.configFile ?? '',
    sshProgram: changes.sshProgram ?? '/x/ssh',
    homeFolder: changes.homeFolder ?? '/home/dev',
    platform: changes.platform ?? 'linux',
  };
}

/** The flag with the argument that stands next to it, or nothing when the flag is absent. */
function flagPair(invocation: Invocation, flag: string): string[] {
  const index = invocation.arguments.indexOf(flag);
  if (index < 0) {
    return [];
  }
  const value = invocation.arguments[index + 1];
  return value === undefined ? [] : [flag, value];
}

/** Whether a flag stands next to a value in a run. */
function hasPair(invocation: Invocation, flag: string, value: string): boolean {
  return invocation.arguments.some(
    (argument, position) =>
      argument === flag && invocation.arguments[position + 1] === value,
  );
}

/** How often a single argument appears in a run. */
function countOf(invocation: Invocation, argument: string): number {
  return invocation.arguments.filter(each => each === argument).length;
}

/** The last argument of a run. */
function lastOf(invocation: Invocation): string {
  return invocation.arguments[invocation.arguments.length - 1] ?? '';
}

/** The arguments of a run that break the option list, or nothing when it holds. */
function forbiddenOf(invocation: Invocation): string[] {
  const forbidden = [
    'ControlMaster',
    'ControlPath',
    'ControlPersist',
    'IdentityFile',
    'IdentityAgent',
    'ProxyCommand',
    'ProxyJump',
    'UserKnownHostsFile',
    'StrictHostKeyChecking',
    'HostKeyAlias',
    '-i',
    '-J',
    '-S',
    '-M',
  ];
  const violations: string[] = [];
  for (const argument of invocation.arguments) {
    if (forbidden.includes(argument)) {
      violations.push(argument);
    }
  }
  const argumentList = invocation.arguments;
  for (let index = 0; index < argumentList.length; index += 1) {
    if (argumentList[index] !== '-o') {
      continue;
    }
    const value = argumentList[index + 1];
    if (
      value !== undefined &&
      value !== 'RemoteCommand=none' &&
      value !== 'ClearAllForwardings=yes' &&
      !value.startsWith('ConnectTimeout=')
    ) {
      violations.push(value);
    }
  }
  return violations;
}

const PURPOSES = ['connection', 'tunnel', 'oneShot'] as const;

/** One forward of each kind, as the row sets them. */
const ALL_FORWARDS: Forward[] = [
  {kind: 'dynamic', localPort: 51000},
  {kind: 'local', localPort: 51001, remotePort: 8080},
  {kind: 'socket', localPort: 51002, socketPath: '/tmp/code-x.sock'},
];

/** The settings the option-sweep row turns on and off. */
const SETTING_VARIANTS = [
  {},
  {configFile: '/etc/custom/config'},
  {connectTimeout: 0},
  {effective: {remoteCommand: 'echo hi'}},
];

/** The environment of one run of every purpose. */
function environmentsOf(): Array<Record<string, string>> {
  return PURPOSES.map(
    purpose => buildInvocation(makeRequest({purpose})).environment,
  );
}

/** The arguments that break the option list, across every purpose and setting. */
function forbiddenSweep(): string[] {
  const violations: string[] = [];
  for (const purpose of PURPOSES) {
    for (const variant of SETTING_VARIANTS) {
      violations.push(
        ...forbiddenOf(
          buildInvocation(
            makeRequest({purpose, forwards: ALL_FORWARDS, ...variant}),
          ),
        ),
      );
    }
    violations.push(
      ...forbiddenOf(
        buildInvocation(
          makeRequest({purpose, forwards: [], clearUserForwards: true}),
        ),
      ),
    );
  }
  return violations;
}

/** The run options that appear in the two query runs, or nothing when none do; `-l` and `-p` select the target. */
function queryFlags(): string[][] {
  const flags = ['-o', '-T', '-v', '-D', '-L'];
  return [
    buildOptionsQuery(makeQuery()),
    buildOptionsQuery(makeQuery({configFile: '/etc/custom/config'})),
  ].map(invocation =>
    flags.filter(flag => invocation.arguments.includes(flag)),
  );
}

describe('buildInvocation (the arguments of one ssh or scp run)', () => {
  it('F-2201.AC-4: an unset configuration file adds no -F', () => {
    strictEqual(flagPair(buildInvocation(makeRequest()), '-F').length, 0);
  });

  it('F-2201.AC-11: a configured file is a -F pair', () => {
    const invocation = buildInvocation(
      makeRequest({configFile: '/etc/custom/config'}),
    );
    deepStrictEqual(flagPair(invocation, '-F'), ['-F', '/etc/custom/config']);
  });

  it('F-2201.BR-3: a ~/ file expands against the home folder', () => {
    const invocation = buildInvocation(makeRequest({configFile: '~/ssh_alt'}));
    deepStrictEqual(flagPair(invocation, '-F'), ['-F', '/home/dev/ssh_alt']);
  });

  it('F-2201.BR-3: a lone ~ is the home folder', () => {
    const invocation = buildInvocation(makeRequest({configFile: '~'}));
    deepStrictEqual(flagPair(invocation, '-F'), ['-F', '/home/dev']);
  });

  const AS_WRITTEN = ['config', '$HOME/x', '${env:HOME}/x'] as const;
  for (const setting of AS_WRITTEN) {
    it(`F-2201.BR-3: a configFile of ${setting} stays as written`, () => {
      const invocation = buildInvocation(makeRequest({configFile: setting}));
      deepStrictEqual(flagPair(invocation, '-F'), ['-F', setting]);
    });
  }

  it('F-2201.BR-2: a spaces-only configFile is used as written', () => {
    const invocation = buildInvocation(makeRequest({configFile: '   '}));
    deepStrictEqual(flagPair(invocation, '-F'), ['-F', '   ']);
  });

  const PSEUDO_TERMINALS: Array<[string, unknown]> = [
    ['false', false],
    ['0', 0],
    ["''", ''],
    ['null', null],
    ['undefined', undefined],
  ];
  for (const [label, value] of PSEUDO_TERMINALS) {
    it(`F-2106.BR-1: permitPtyAllocation ${label} adds -T once`, () => {
      const invocation = buildInvocation(
        makeRequest({permitPtyAllocation: value}),
      );
      strictEqual(countOf(invocation, '-T'), 1);
    });
  }

  const TERMINALS_ALLOWED: Array<[string, unknown]> = [
    ['true', true],
    ['1', 1],
    ["'yes'", 'yes'],
  ];
  for (const [label, value] of TERMINALS_ALLOWED) {
    it(`F-2106.BR-1: permitPtyAllocation ${label} adds no -T`, () => {
      const invocation = buildInvocation(
        makeRequest({permitPtyAllocation: value}),
      );
      strictEqual(countOf(invocation, '-T'), 0);
    });
  }

  for (const purpose of ['tunnel', 'oneShot'] as const) {
    it(`F-2106.BR-8: purpose ${purpose} adds no -T`, () => {
      const invocation = buildInvocation(
        makeRequest({purpose, permitPtyAllocation: false}),
      );
      strictEqual(countOf(invocation, '-T'), 0);
    });
  }

  for (const purpose of PURPOSES) {
    it(`F-2109.BR-3: purpose ${purpose} carries exactly one -v`, () => {
      const invocation = buildInvocation(makeRequest({purpose}));
      strictEqual(countOf(invocation, '-v'), 1);
    });
  }

  for (const purpose of PURPOSES) {
    it(`F-2107.BR-1: purpose ${purpose} with a remote command adds RemoteCommand=none`, () => {
      const invocation = buildInvocation(
        makeRequest({purpose, effective: {remoteCommand: 'echo hi'}}),
      );
      strictEqual(hasPair(invocation, '-o', 'RemoteCommand=none'), true);
    });
  }

  it('F-2107.BR-1: a remote command in effect adds no RemoteCommand', () => {
    const invocation = buildInvocation(
      makeRequest({
        effective: {remoteCommand: 'echo hi'},
        remoteCommandInEffect: true,
      }),
    );
    strictEqual(invocation.arguments.includes('RemoteCommand=none'), false);
  });

  it('F-2107.BR-1: no remote command adds no RemoteCommand', () => {
    const invocation = buildInvocation(
      makeRequest({remoteCommandInEffect: false}),
    );
    strictEqual(invocation.arguments.includes('RemoteCommand=none'), false);
  });

  it('F-2104.BR-1: a dynamic forward is a -D pair', () => {
    const invocation = buildInvocation(
      makeRequest({
        forwards: [{kind: 'dynamic', localPort: 51000}],
      }),
    );
    strictEqual(hasPair(invocation, '-D', '127.0.0.1:51000'), true);
  });

  it('F-2104.BR-1: a local forward is a -L pair', () => {
    const invocation = buildInvocation(
      makeRequest({
        forwards: [{kind: 'local', localPort: 51001, remotePort: 8080}],
      }),
    );
    strictEqual(
      hasPair(invocation, '-L', '127.0.0.1:51001:127.0.0.1:8080'),
      true,
    );
  });

  it('F-2410: a socket forward is a -L pair to the path', () => {
    const invocation = buildInvocation(
      makeRequest({
        forwards: [
          {kind: 'socket', localPort: 51002, socketPath: '/tmp/code-x.sock'},
        ],
      }),
    );
    strictEqual(
      hasPair(invocation, '-L', '127.0.0.1:51002:/tmp/code-x.sock'),
      true,
    );
  });

  it('F-2104.BR-1: both forwards stand in the given order', () => {
    const invocation = buildInvocation(
      makeRequest({
        forwards: [
          {kind: 'dynamic', localPort: 51000},
          {kind: 'local', localPort: 51001, remotePort: 8080},
        ],
      }),
    );
    deepStrictEqual(
      invocation.arguments.slice(
        invocation.arguments.indexOf('-D'),
        invocation.arguments.indexOf('--'),
      ),
      ['-D', '127.0.0.1:51000', '-L', '127.0.0.1:51001:127.0.0.1:8080'],
    );
  });

  it('F-2104.BR-1: no forward adds neither -D nor -L', () => {
    const invocation = buildInvocation(makeRequest({forwards: []}));
    strictEqual(
      invocation.arguments.some(
        argument => argument === '-D' || argument === '-L',
      ),
      false,
    );
  });

  it('#353 (themis, athena): a local forward names 127.0.0.1 as its bind address', () => {
    const invocation = buildInvocation(
      makeRequest({
        forwards: [{kind: 'local', localPort: 51001, remotePort: 8080}],
      }),
    );
    strictEqual(flagPair(invocation, '-L')[1]?.startsWith('127.0.0.1:'), true);
  });

  it('#353 (themis, athena): a socket forward names 127.0.0.1 as its bind address', () => {
    const invocation = buildInvocation(
      makeRequest({
        forwards: [
          {kind: 'socket', localPort: 51002, socketPath: '/tmp/code-x.sock'},
        ],
      }),
    );
    strictEqual(flagPair(invocation, '-L')[1]?.startsWith('127.0.0.1:'), true);
  });

  it('F-2104 6.2 step 4: a run of all three forwards names 127.0.0.1 on every -L value', () => {
    const invocation = buildInvocation(makeRequest({forwards: ALL_FORWARDS}));
    const localValues: string[] = [];
    for (let index = 1; index < invocation.arguments.length; index += 1) {
      const previous = invocation.arguments[index - 1];
      if (previous === '-L') {
        localValues.push(invocation.arguments[index] ?? '');
      }
    }
    deepStrictEqual(
      [
        localValues.length,
        localValues.every(each => each.startsWith('127.0.0.1:')),
      ],
      [2, true],
    );
  });

  it('F-2205.BR-4: the host is last, with no -l and no -p', () => {
    const invocation = buildInvocation(makeRequest());
    deepStrictEqual(
      [
        lastOf(invocation),
        countOf(invocation, '-l'),
        countOf(invocation, '-p'),
      ],
      ['alias', 0, 0],
    );
  });

  it('F-2205.7.E10: a host with a blank is one argument', () => {
    const invocation = buildInvocation(makeRequest({target: {host: 'a b'}}));
    strictEqual(lastOf(invocation), 'a b');
  });

  it('F-2205.7.E10: an empty user adds no user argument', () => {
    const invocation = buildInvocation(
      makeRequest({target: {host: 'h', user: ''}}),
    );
    strictEqual(countOf(invocation, '-l'), 0);
  });

  it('S2 contract: a oneShot run ends with the host and its program', () => {
    const invocation = buildInvocation(
      makeRequest({purpose: 'oneShot', remoteProgram: 'uname -s'}),
    );
    deepStrictEqual(invocation.arguments.slice(-2), ['alias', 'uname -s']);
  });

  it('S2 contract: a oneShot run without a program ends at the host', () => {
    const invocation = buildInvocation(makeRequest({purpose: 'oneShot'}));
    strictEqual(lastOf(invocation), 'alias');
  });

  it('S2 contract: a connection run ends at the host', () => {
    const invocation = buildInvocation(makeRequest());
    strictEqual(lastOf(invocation), 'alias');
  });

  for (const purpose of PURPOSES) {
    it(`S2 contract: purpose ${purpose} runs the checked ssh program`, () => {
      const invocation = buildInvocation(makeRequest({purpose}));
      strictEqual(invocation.program, '/x/ssh');
    });
  }

  it('F-2309.BR-2: the environment stays empty for every purpose', () => {
    deepStrictEqual(environmentsOf(), [{}, {}, {}]);
  });

  it('F-2405.BR-6: a copy run copies the file to the alias', () => {
    deepStrictEqual(buildInvocation(makeCopyRequest()), {
      program: '/x/scp',
      arguments: ['--', '/tmp/boot.sh', 'alias:/tmp/x/boot.sh'],
      environment: {},
    });
  });

  it('F-2405.BR-6: a copy run keeps the configuration file', () => {
    const invocation = buildInvocation(
      makeCopyRequest({configFile: '/etc/custom/config'}),
    );
    deepStrictEqual(invocation.arguments, [
      '-F',
      '/etc/custom/config',
      '--',
      '/tmp/boot.sh',
      'alias:/tmp/x/boot.sh',
    ]);
  });

  it('F-2405.BR-6: a copy run carries no ssh option', () => {
    const invocation = buildInvocation(makeCopyRequest());
    strictEqual(
      ['-T', '-v', '-o', '-D', '-L'].some(flag =>
        invocation.arguments.includes(flag),
      ),
      false,
    );
  });

  it('ADR-0004.2: no option beyond the listed ones, in every purpose and setting', () => {
    deepStrictEqual(forbiddenSweep(), []);
  });

  it('S2 contract: a user carried by the target is a -l pair', () => {
    const invocation = buildInvocation(
      makeRequest({target: {host: 'alias', user: 'u'}}),
    );
    deepStrictEqual(
      [flagPair(invocation, '-l'), lastOf(invocation)],
      [['-l', 'u'], 'alias'],
    );
  });

  it('F-2501.BR-2 / AC-9: a port carried by the target is a -p pair', () => {
    const invocation = buildInvocation(
      makeRequest({target: {host: 'alias', port: 2222}}),
    );
    deepStrictEqual(
      [flagPair(invocation, '-p'), lastOf(invocation)],
      [['-p', '2222'], 'alias'],
    );
  });

  it('F-2501.BR-2: a port from the configuration adds no -p', () => {
    const invocation = buildInvocation(
      makeRequest({target: {host: 'alias'}, effective: {port: '2200'}}),
    );
    strictEqual(countOf(invocation, '-p'), 0);
  });

  it('F-2704.BR-1: a terminal connection keeps -T and runs the program', () => {
    const invocation = buildInvocation(makeRequest({remoteProgram: 'sh'}));
    deepStrictEqual(
      [countOf(invocation, '-T'), invocation.arguments.slice(-2)],
      [1, ['alias', 'sh']],
    );
  });

  it('F-2106.6.3: a terminal connection with a pseudo-terminal adds no -T', () => {
    const invocation = buildInvocation(
      makeRequest({remoteProgram: 'sh', permitPtyAllocation: true}),
    );
    deepStrictEqual(
      [countOf(invocation, '-T'), invocation.arguments.slice(-2)],
      [0, ['alias', 'sh']],
    );
  });

  it('F-2405.BR-6: a copy run ignores the user and the port of the target', () => {
    const invocation = buildInvocation(
      makeCopyRequest({target: {host: 'alias', user: 'u', port: 2222}}),
    );
    deepStrictEqual(invocation.arguments, [
      '--',
      '/tmp/boot.sh',
      'alias:/tmp/x/boot.sh',
    ]);
  });

  it('#253 Q9: a host that looks like an option stands behind --', () => {
    const invocation = buildInvocation(
      makeRequest({target: {host: '-oProxyCommand=x'}}),
    );
    const index = invocation.arguments.indexOf('-oProxyCommand=x');
    strictEqual(invocation.arguments[index - 1], '--');
  });

  it('#253 Q9: a oneShot run ends with -- the host and its program', () => {
    const invocation = buildInvocation(
      makeRequest({purpose: 'oneShot', remoteProgram: 'uname -s'}),
    );
    deepStrictEqual(invocation.arguments.slice(-3), [
      '--',
      'alias',
      'uname -s',
    ]);
  });

  it('#253 Q9: a copy run breaks the option list once, before the local file', () => {
    const invocation = buildInvocation(makeCopyRequest());
    deepStrictEqual(
      [countOf(invocation, '--'), invocation.arguments],
      [1, ['--', '/tmp/boot.sh', 'alias:/tmp/x/boot.sh']],
    );
  });

  it('F-2405.BR-6 (provisional): a bracketed host for a copy run', () => {
    const invocation = buildInvocation(
      makeCopyRequest({target: {host: '::1'}}),
    );
    strictEqual(lastOf(invocation), '[::1]:/tmp/x/boot.sh');
  });

  it('F-2105.BR-2 (provisional): a fractional timeout is written as given', () => {
    const invocation = buildInvocation(makeRequest({connectTimeout: 2.5}));
    strictEqual(hasPair(invocation, '-o', 'ConnectTimeout=2.5'), true);
  });
  it('F-2308 BR-10: a tunnel run ends with its own command', () => {
    const invocation = buildInvocation(makeRequest({purpose: 'tunnel'}));
    strictEqual(lastOf(invocation), TUNNEL_COMMAND);
  });

  it('F-2308 BR-10: the tunnel command stands behind -- and the host', () => {
    const invocation = buildInvocation(makeRequest({purpose: 'tunnel'}));
    deepStrictEqual(invocation.arguments.slice(-3), [
      '--',
      'alias',
      TUNNEL_COMMAND,
    ]);
  });

  it('brief, #299: a tunnel run ignores a remoteProgram', () => {
    const invocation = buildInvocation(
      makeRequest({purpose: 'tunnel', remoteProgram: 'uname -s'}),
    );
    strictEqual(lastOf(invocation), TUNNEL_COMMAND);
  });

  it('brief, #299: a tunnel run carries no -N', () => {
    const invocation = buildInvocation(makeRequest({purpose: 'tunnel'}));
    strictEqual(invocation.arguments.includes('-N'), false);
  });

  it('F-2104 BR-11, BR-12: a tunnel run carries no ExitOnForwardFailure', () => {
    const invocation = buildInvocation(makeRequest({purpose: 'tunnel'}));
    strictEqual(
      invocation.arguments.some(argument =>
        argument.includes('ExitOnForwardFailure'),
      ),
      false,
    );
  });

  it('F-2104 6.2: a tunnel run keeps its local forward before the host', () => {
    const invocation = buildInvocation(
      makeRequest({
        purpose: 'tunnel',
        forwards: [{kind: 'local', localPort: 51001, remotePort: 8080}],
      }),
    );
    deepStrictEqual(
      invocation.arguments.slice(invocation.arguments.indexOf('-L')),
      ['-L', '127.0.0.1:51001:127.0.0.1:8080', '--', 'alias', TUNNEL_COMMAND],
    );
  });

  it('F-2410 5.0: a tunnel run keeps its socket forward before the host', () => {
    const invocation = buildInvocation(
      makeRequest({
        purpose: 'tunnel',
        forwards: [
          {kind: 'socket', localPort: 51002, socketPath: '/tmp/code-x.sock'},
        ],
      }),
    );
    deepStrictEqual(
      invocation.arguments.slice(invocation.arguments.indexOf('-L')),
      ['-L', '127.0.0.1:51002:/tmp/code-x.sock', '--', 'alias', TUNNEL_COMMAND],
    );
  });

  it('F-2104 6.2 step 1: an install run with the clearing adds ClearAllForwardings=yes once', () => {
    const invocation = buildInvocation(
      makeRequest({
        purpose: 'connection',
        remoteProgram: 'sh',
        clearUserForwards: true,
      }),
    );
    deepStrictEqual(
      [
        hasPair(invocation, '-o', 'ClearAllForwardings=yes'),
        countOf(invocation, 'ClearAllForwardings=yes'),
      ],
      [true, 1],
    );
  });

  it('F-2104 6.2 step 1: an install run without the clearing adds no ClearAllForwardings', () => {
    const invocation = buildInvocation(
      makeRequest({purpose: 'connection', remoteProgram: 'sh'}),
    );
    strictEqual(
      invocation.arguments.includes('ClearAllForwardings=yes'),
      false,
    );
  });

  it('F-2104 6.3: the clearing beside our own forwards is refused', () => {
    const request = makeRequest({
      purpose: 'connection',
      forwards: [{kind: 'dynamic', localPort: 51000}],
      clearUserForwards: true,
    });
    throws(
      () => buildInvocation(request),
      /would also clear the run's own forwards/,
    );
  });

  it('brief, #299: a tunnel run ignores the clearing', () => {
    const invocation = buildInvocation(
      makeRequest({purpose: 'tunnel', forwards: [], clearUserForwards: true}),
    );
    strictEqual(
      invocation.arguments.includes('ClearAllForwardings=yes'),
      false,
    );
  });

  it('F-2104 BR-12: TUNNEL_COMMAND is the up line and the hold', () => {
    strictEqual(
      TUNNEL_COMMAND,
      "echo 'Connected to SSH Host - Please do not close this terminal'; exec sleep 2147483647",
    );
  });
});

describe('expandHome (a leading ~ against the home folder)', () => {
  const LINUX_PATHS: Array<[string, string]> = [
    ['~/a b', '/home/dev/a b'],
    ['~x', '~x'],
    ['/abs', '/abs'],
    ['~\\x', '~\\x'],
  ];
  for (const [file, expanded] of LINUX_PATHS) {
    it(`F-2201.BR-3: a linux path of ${file} expands to ${expanded}`, () => {
      strictEqual(expandHome(file, '/home/dev', 'linux'), expanded);
    });
  }

  const WINDOWS_PATHS: Array<[string, string]> = [
    ['~/x', 'C:\\Users\\dev\\x'],
    ['~\\x', 'C:\\Users\\dev\\x'],
    ['C:/x', 'C:/x'],
    ['~', 'C:\\Users\\dev'],
  ];
  for (const [file, expanded] of WINDOWS_PATHS) {
    it(`F-2201.Q4 (lead 2026-10-07): a windows path of ${file} expands to ${expanded}`, () => {
      strictEqual(expandHome(file, 'C:\\Users\\dev', 'windows'), expanded);
    });
  }

  it('F-2201.Q4 (lead 2026-10-07): a windows configFile of ~\\ expands for -F', () => {
    const invocation = buildInvocation(
      makeRequest({
        platform: 'windows',
        homeFolder: 'C:\\Users\\dev',
        configFile: '~\\ssh_alt',
      }),
    );
    deepStrictEqual(flagPair(invocation, '-F'), [
      '-F',
      'C:\\Users\\dev\\ssh_alt',
    ]);
  });
});

describe('buildOptionsQuery (the ssh -G run)', () => {
  it('S4 contract: the query is the ssh program with -G and the host', () => {
    deepStrictEqual(buildOptionsQuery(makeQuery()), {
      program: '/x/ssh',
      arguments: ['-G', '--', 'alias'],
      environment: {},
    });
  });

  it('S4 contract: a ~ configuration file expands before -G', () => {
    const invocation = buildOptionsQuery(makeQuery({configFile: '~/c'}));
    deepStrictEqual(invocation.arguments, [
      '-F',
      '/home/dev/c',
      '-G',
      '--',
      'alias',
    ]);
  });

  it('ADR-0004.2: the query carries no run option', () => {
    deepStrictEqual(queryFlags(), [[], []]);
  });

  it('connect-14: the query names the target as the connection does, with its user and port', () => {
    deepStrictEqual(
      buildOptionsQuery(
        makeQuery({target: {host: 'h1', user: 'alice', port: 2222}}),
      ).arguments.slice(-7),
      ['-G', '-l', 'alice', '-p', '2222', '--', 'h1'],
    );
  });

  it('connect-14: a target with no user or port is the host alone after -G', () => {
    deepStrictEqual(
      buildOptionsQuery(makeQuery({target: {host: 'h1'}})).arguments.slice(-3),
      ['-G', '--', 'h1'],
    );
  });
});
