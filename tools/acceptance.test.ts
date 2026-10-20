import {
  deepStrictEqual,
  notStrictEqual,
  rejects,
  strictEqual,
  throws,
} from 'node:assert';
import type {PortHolder} from './acceptance-occupy.ts';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  acceptanceConfiguration,
  type AttemptResult,
  bundleSuite,
  FRESH_RESOLVE_WAIT_MILLISECONDS,
  type Sleeper,
  downloadWithRetry,
  editorChoiceOf,
  chosenLaunches,
  selectionLine,
  editorExecutableOf,
  runArgumentsOf,
  type CommandResult,
  failureText,
  harnessSshConfig,
  type HarnessDependencies,
  type HarnessVariables,
  mappedPort,
  installsOf,
  packagedExtensions,
  removeBundles,
  RETRY_PAUSE_MILLISECONDS,
  runAcceptance,
  runCommand,
  runLaunches,
  runTestCli,
  standInEngines,
  unpackArchive,
  USAGE,
  VSCODIUM_RELEASE,
  vscodiumConfiguration,
  vscodiumConfigurations,
  vscodiumExecutableOf,
  withOneRetry,
  markDownloadRequests,
  writeUserSettings,
} from './acceptance.ts';
import type {RunDownloads} from './acceptance-downloads.ts';
import type {Started} from './acceptance-plain.ts';
import {
  failureCases,
  launchesOf,
  launchGroupOf,
  launchLabelled,
  type Launch,
  type RunnerLaunch,
} from './acceptance-launches.ts';
import type {RunRegistry} from './acceptance-registry.ts';
import {STOP_PROGRAM} from './acceptance-helper-stop.ts';
import {acceptanceRunId} from './acceptance-run.ts';
import type {CommandRunner} from './command-runner.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const CONTAINER = 'c0ffee';

/** The host's address on the run network, which the `routed` alias names. */
const ROUTED_ADDRESS = '172.18.0.2';

/** A harness whose commands succeed, recording each call; `answers` overrides the result of a program. */
class FakeHarness implements HarnessDependencies {
  readonly calls: string[] = [];
  readonly sleeps: number[] = [];
  variables: HarnessVariables | undefined;
  runFolder = '';
  sshFailures = 0;
  bundleSuiteError: Error | undefined;
  testResult: AttemptResult = {exitCode: 0, output: ''};
  readonly labelResults = new Map<string, AttemptResult>();
  readonly launched: Array<string | undefined> = [];
  /** The files of the run's folder as the first launch found them, by name. */
  readonly firstLaunchFiles = new Map<string, string>();
  readonly answers = new Map<string, CommandResult>();
  /** What each launch with stand-ins found in its extensions folder when it started, by label: the stand-in's manifest, the list's last entry. */
  readonly standInFound = new Map<string, [unknown, unknown]>();
  /** What a client-search launch found in the run's folder when it started. */
  readonly clientLaunches: Array<{
    label: string;
    fakes: boolean;
    vanishing: boolean;
    tildeCopy: boolean;
    calls: string;
    settings: string;
  }> = [];

  readonly command = (
    program: string,
    programArguments: readonly string[],
  ): CommandResult => {
    this.calls.push([program, ...programArguments].join(' '));
    const answer = this.answers.get(`${program} ${programArguments[0] ?? ''}`);
    if (answer !== undefined) {
      return answer;
    }
    const extensionsFolder = programArguments
      .find(argument => argument.startsWith('--extensions-dir='))
      ?.slice('--extensions-dir='.length);
    if (extensionsFolder !== undefined) {
      // The editor's install lists what it installed in the folder's extensions.json; a stand-in copies an entry of it.
      mkdirSync(extensionsFolder, {recursive: true});
      writeFileSync(
        path.join(extensionsFolder, 'extensions.json'),
        JSON.stringify([
          {
            identifier: {id: 'remote-oss.installed'},
            version: '1.0.0',
            location: {
              $mid: 1,
              fsPath: path.join(extensionsFolder, 'installed'),
              path: path.join(extensionsFolder, 'installed'),
              scheme: 'file',
            },
            relativeLocation: 'installed',
            metadata: {source: 'vsix'},
          },
        ]),
      );
    }
    if (program === 'ssh-keygen' || program === 'env') {
      const keyFile = programArguments.at(-1) ?? '';
      this.runFolder = path.dirname(keyFile);
      writeFileSync(keyFile, 'private key\n');
      writeFileSync(`${keyFile}.pub`, 'ssh-ed25519 AAAA acceptance\n');
    }
    if (program === 'ssh' && this.sshFailures > 0) {
      this.sshFailures -= 1;
      return {status: 255, stdout: '', stderr: 'Connection refused'};
    }
    const stdout =
      programArguments[0] === 'run'
        ? `${CONTAINER}\n`
        : programArguments[0] === 'port'
          ? '127.0.0.1:49153\n'
          : programArguments[0] === 'inspect' &&
              programArguments.some(argument => argument.includes('IPAddress'))
            ? `${ROUTED_ADDRESS}\n`
            : '';
    return {status: 0, stdout, stderr: ''};
  };

  readonly sleep = (milliseconds: number): Promise<void> => {
    this.sleeps.push(milliseconds);
    return Promise.resolve();
  };

  readonly bundleSuite = (): Promise<void> => {
    this.calls.push('bundle suite');
    if (this.bundleSuiteError !== undefined) {
      return Promise.reject(this.bundleSuiteError);
    }
    return Promise.resolve();
  };

  readonly editorCli = (): Promise<string> => Promise.resolve('code');

  readonly startAgent = (socket: string): Started => {
    this.calls.push(`agent started ${socket}`);
    return {
      stop: () => {
        this.calls.push('agent stopped');
        return Promise.resolve();
      },
    };
  };

  readonly startRegistry = (runId: string): Promise<RunRegistry> => {
    this.calls.push(`registry started ${runId}`);
    return Promise.resolve({
      address: '127.0.0.1:5000',
      stop: () => {
        this.calls.push('registry stopped');
        return Promise.resolve();
      },
    });
  };

  readonly startDownloads = (): Promise<RunDownloads> => {
    this.calls.push('downloads started');
    return Promise.resolve({
      variables: {HARNESS_DOWNLOADS_HTTP: 'http://downloads:8080'},
      stop: () => {
        this.calls.push('downloads stopped');
        return Promise.resolve();
      },
    });
  };

  readonly windowAgentVsix = (): Promise<string> => {
    this.calls.push('window agent vsix');
    return Promise.resolve('window-agent.vsix');
  };

  readonly runPlain = (
    root: string,
    variables: HarnessVariables,
    launch: Launch,
  ): Promise<AttemptResult> => {
    this.variables = variables;
    this.launched.push(launch.label);
    if (launch.kind === 'plain' && launch.standIns !== undefined) {
      const folder = path.join(
        variables.HARNESS_RUN_FOLDER,
        `extensions-${launch.label}`,
      );
      this.standInFound.set(launch.label, [
        JSON.parse(
          readFileSync(
            path.join(
              folder,
              `${launch.standIns[0] ?? ''}-0.0.0`,
              'package.json',
            ),
            'utf8',
          ),
        ),
        (
          JSON.parse(
            readFileSync(path.join(folder, 'extensions.json'), 'utf8'),
          ) as unknown[]
        ).at(-1),
      ]);
    }
    return Promise.resolve(
      this.labelResults.get(launch.label) ?? this.testResult,
    );
  };

  readonly vscodiumExecutable = (): Promise<string> => {
    this.calls.push('vscodium executable');
    return Promise.resolve('codium-insiders');
  };

  readonly vscodeExecutable = (): Promise<string> => {
    this.calls.push('vscode executable');
    return Promise.resolve('/vscode/code');
  };

  readonly runTests = (
    root: string,
    variables: HarnessVariables,
    label?: string,
  ): Promise<AttemptResult> => {
    this.variables = variables;
    const folder = variables.HARNESS_RUN_FOLDER;
    if (label === 'remote') {
      // A call a launch before the client searches made: the run must not hand it on.
      writeFileSync(path.join(folder, 'clients', 'calls.log'), 'stale\n');
    }
    if (label?.startsWith('client-') === true) {
      const vanishing = path.join(folder, 'clients', 'vanishing', 'ssh');
      this.clientLaunches.push({
        label,
        fakes: existsSync(path.join(folder, 'clients', 'path', 'ssh')),
        vanishing: existsSync(vanishing),
        tildeCopy: existsSync(path.join(folder, 'home', 'clients-copy', 'ssh')),
        calls: readFileSync(path.join(folder, 'clients', 'calls.log'), 'utf8'),
        settings: readFileSync(
          path.join(folder, 'user-data', 'User', 'settings.json'),
          'utf8',
        ),
      });
      // The first attempt of the vanishing launch finds the client, and its check deletes it: simulate the
      // launch doing so, so a retried attempt must find it rewritten.
      if (
        label === 'client-vanishing' &&
        this.launched.filter(each => each === label).length === 0 &&
        existsSync(vanishing)
      ) {
        rmSync(vanishing);
      }
    }
    if (this.launched.length === 0) {
      for (const name of readdirSync(variables.HARNESS_RUN_FOLDER).filter(
        entry =>
          statSync(path.join(variables.HARNESS_RUN_FOLDER, entry)).isFile(),
      )) {
        this.firstLaunchFiles.set(
          name,
          readFileSync(path.join(variables.HARNESS_RUN_FOLDER, name), 'utf8'),
        );
      }
    }
    this.launched.push(label);
    return Promise.resolve(
      this.labelResults.get(label ?? '') ?? this.testResult,
    );
  };
}

/** The sleeper and reporter of the retry rows, recording their calls. */
class RetryRecorder {
  readonly sleeps: number[] = [];
  readonly lines: string[] = [];

  readonly sleep = (milliseconds: number): Promise<void> => {
    this.sleeps.push(milliseconds);
    return Promise.resolve();
  };

  readonly report = (line: string): void => {
    this.lines.push(line);
  };
}

/** Steps a list of outcomes one per call, repeating the last, and counts the calls. */
function scriptedStep(outcomes: unknown[]) {
  let calls = 0;

  function step(): Promise<unknown> {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }
    return Promise.resolve(outcome);
  }

  function called(): number {
    return calls;
  }
  return {step, called};
}

const FAILURE = {
  alias: 'refused',
  cite: 'F-2601 AC-1',
  script: [{surface: 'failureDialog', match: 'refused', answer: 'dismiss'}],
  dialog: 'Could not establish connection to "refused".',
};

/** The labels a run launches with the fixture's cases, in order: the ports case last. */
const LAUNCH_ORDER = [
  'local',
  'remote',
  'reconnect',
  'agent',
  'agent-off',
  'x11',
  'failure-refused',
  'terminal',
  'socket',
  'slow',
  'client-unset',
  'terminal-pick',
  'windows',
  'login-shells',
  'config-files',
  'default-ports',
  'no-proposals',
  'explorer',
  'explorer-alone',
  'explorer-no-proposals',
  'explorer-standdown',
  'trust',
  'trust-terminal',
  'containers',
  'containers-standdown',
  'containers-no-proposals',
  'containers-trust',
  'containers-volume',
  'containers-explorer',
  'containers-ports',
  'ports-probe',
  'install-probe',
  'platform-probe',
];

const CLIENT_CASE = {
  label: 'client-unset',
  cite: 'F-2101 AC-1',
  setting: null,
  checked: ['path/ssh'],
  used: 'path/ssh',
};

/** The labels of the launches `selected` chooses from `launches`, or the error text alone when it names an unknown one. */
function chosenLabels(
  launches: readonly Launch[],
  selected: string[] | undefined,
): string[] {
  const chosen = chosenLaunches(launches, selected);
  return typeof chosen === 'string'
    ? [chosen]
    : chosen.map(launch => launch.label);
}
describe('acceptance', () => {
  let workspace: TemporaryWorkspace;
  let harness: FakeHarness;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('acceptance');
    harness = new FakeHarness();
    workspace.write(
      'packages/remote-containers/package.json',
      JSON.stringify({engines: {vscode: '^1.139.0'}}),
    );
    workspace.write(
      'packages/remote-explorer/package.json',
      JSON.stringify({engines: {vscode: '^1.139.0'}}),
    );
    workspace.write(
      'tests/acceptance/suite-failure/cases.json',
      JSON.stringify({cases: [FAILURE]}),
    );
    workspace.write(
      'tests/acceptance/suite-ports/cases.json',
      JSON.stringify({
        cases: [
          {
            label: 'probe',
            cite: 'F-2409 AC-2 (probe)',
            settings: {},
            outcome: 'connected',
          },
        ],
      }),
    );
    workspace.write(
      'tests/acceptance/suite-platform/cases.json',
      JSON.stringify({
        cases: [
          {
            label: 'probe',
            cite: 'F-2206 AC-1 (platform-probe)',
            settings: {},
            outcome: 'connected',
          },
        ],
      }),
    );
    workspace.write(
      'tests/acceptance/suite-install/cases.json',
      JSON.stringify({
        cases: [
          {
            label: 'probe',
            cite: 'F-2403 AC-1 (probe)',
            settings: {
              'remote.SSH.serverDownloadUrlTemplate':
                '${HARNESS_DOWNLOADS_HTTP}/ok/${commit}',
            },
            outcome: 'connected',
          },
        ],
      }),
    );
    workspace.write(
      'tests/acceptance/suite-client/cases.json',
      JSON.stringify({cases: [CLIENT_CASE]}),
    );
  });

  afterEach(() => {
    workspace.remove();
  });

  describe('mappedPort', () => {
    it('reads the host port of a docker port line', () => {
      strictEqual(mappedPort('127.0.0.1:49153\n'), 49153);
    });

    it('fails when the output names no port', () => {
      throws(() => mappedPort('\n'), {message: "no mapped port in ''"});
    });
  });

  it('writes Host harness with the run key, its own known hosts and no agent', () => {
    strictEqual(
      harnessSshConfig(49153, '/run', '/run/agent.sock', ROUTED_ADDRESS).split(
        '\n\n',
      )[0],
      [
        'Host harness',
        '  HostName 127.0.0.1',
        '  Port 49153',
        '  User harness',
        '  IdentityFile /run/id_ed25519',
        '  IdentitiesOnly yes',
        '  IdentityAgent none',
        '  StrictHostKeyChecking accept-new',
        '  BatchMode yes',
        '  ConnectTimeout 10',
        '  UserKnownHostsFile /run/known_hosts',
      ].join('\n'),
    );
  });

  it('coverage-13: Host 127.0.0.1 reaches the harness host by the address as typed', () => {
    strictEqual(
      harnessSshConfig(49153, '/run', '/run/agent.sock', ROUTED_ADDRESS).split(
        '\n\n',
      )[1],
      [
        'Host 127.0.0.1',
        '  Port 49153',
        '  User harness',
        '  IdentityFile /run/id_ed25519',
        '  IdentitiesOnly yes',
        '  IdentityAgent none',
        '  StrictHostKeyChecking accept-new',
        '  BatchMode yes',
        '  ConnectTimeout 10',
        '  UserKnownHostsFile /run/known_hosts',
      ].join('\n'),
    );
  });

  it('F-2601 AC-1: Host refused points at a closed port of the loopback', () => {
    strictEqual(
      harnessSshConfig(49153, '/run', '/run/agent.sock', ROUTED_ADDRESS).split(
        '\n\n',
      )[2],
      [
        'Host refused',
        '  HostName 127.0.0.1',
        '  Port 9',
        '  BatchMode yes',
      ].join('\n'),
    );
  });

  it('coverage-39: Host blackhole names an address of TEST-NET-1, which is never routed, so a connect waits', () => {
    const blocks = harnessSshConfig(
      49153,
      '/run',
      '/run/agent.sock',
      ROUTED_ADDRESS,
    ).split('\n\n');
    strictEqual(
      blocks.find(block => block.startsWith('Host blackhole'))?.trimEnd(),
      ['Host blackhole', '  HostName 192.0.2.1', '  BatchMode yes'].join('\n'),
    );
  });

  it('F-2601 AC-3: Host nowhere names a host that never resolves', () => {
    strictEqual(
      harnessSshConfig(49153, '/run', '/run/agent.sock', ROUTED_ADDRESS).split(
        '\n\n',
      )[3],
      ['Host nowhere', '  HostName nowhere.invalid', '  BatchMode yes'].join(
        '\n',
      ),
    );
  });

  it('F-2601 AC-6: Host stranger is the harness host with its own empty known hosts, and asks', () => {
    strictEqual(
      harnessSshConfig(49153, '/run', '/run/agent.sock', ROUTED_ADDRESS).split(
        '\n\n',
      )[4],
      [
        'Host stranger',
        '  HostName 127.0.0.1',
        '  Port 49153',
        '  User harness',
        '  IdentityFile /run/id_ed25519',
        '  IdentitiesOnly yes',
        '  IdentityAgent none',
        '  StrictHostKeyChecking ask',
        '  UserKnownHostsFile /run/known_hosts_stranger',
      ].join('\n'),
    );
  });

  /** The alias blocks of the host's other accounts, after the four failure aliases. */
  function accountBlock(name: string): string {
    return (
      harnessSshConfig(49153, '/run', '/run/agent.sock', ROUTED_ADDRESS)
        .split('\n\n')
        .find(block => block.startsWith(`Host ${name}\n`))
        ?.trimEnd() ?? ''
    );
  }

  it("tooling-47: the run's ssh_config has the routed alias at the run-network address, with no connect timeout", () => {
    strictEqual(
      accountBlock('routed'),
      [
        'Host routed',
        `  HostName ${ROUTED_ADDRESS}`,
        '  Port 22',
        '  User harness',
        '  IdentityFile /run/id_ed25519',
        '  IdentitiesOnly yes',
        '  IdentityAgent none',
        '  StrictHostKeyChecking accept-new',
        '  BatchMode yes',
        '  UserKnownHostsFile /run/known_hosts_routed',
      ].join('\n'),
    );
  });

  /** The lines every alias of the other accounts shares, with its user and its own known-hosts file. */
  function sharedLines(name: string, user: string): string[] {
    return [
      `Host ${name}`,
      '  HostName 127.0.0.1',
      '  Port 49153',
      `  User ${user}`,
      '  IdentityAgent none',
      '  StrictHostKeyChecking accept-new',
      '  ConnectTimeout 10',
      `  UserKnownHostsFile /run/known_hosts_${name}`,
    ];
  }

  const PASSWORD_ALIAS_LINES = [
    '  PubkeyAuthentication no',
    '  PreferredAuthentications password,keyboard-interactive',
    '  NumberOfPasswordPrompts 1',
  ];

  const KEY_ALIAS_LINES = [
    '  IdentityFile /run/id_ed25519',
    '  IdentitiesOnly yes',
    '  BatchMode yes',
  ];

  it('D-85: Host password logs in to harness-pw by password, without BatchMode', () => {
    strictEqual(
      accountBlock('password'),
      [...sharedLines('password', 'harness-pw'), ...PASSWORD_ALIAS_LINES].join(
        '\n',
      ),
    );
  });

  it('D-85: Host password-ask is the password account whose host key is asked, against its own known hosts', () => {
    strictEqual(
      accountBlock('password-ask'),
      [
        'Host password-ask',
        '  HostName 127.0.0.1',
        '  Port 49153',
        '  User harness-pw',
        '  IdentityAgent none',
        '  StrictHostKeyChecking ask',
        '  ConnectTimeout 10',
        '  UserKnownHostsFile /run/known_hosts_password_ask',
        ...PASSWORD_ALIAS_LINES,
      ].join('\n'),
    );
  });

  it('D-85: Host noforward logs in to harness-nofwd with the run key', () => {
    strictEqual(
      accountBlock('noforward'),
      [...sharedLines('noforward', 'harness-nofwd'), ...KEY_ALIAS_LINES].join(
        '\n',
      ),
    );
  });

  it('coverage-43: Host harness-fish logs in to harness-fish with the run key', () => {
    strictEqual(
      accountBlock('harness-fish'),
      [...sharedLines('harness-fish', 'harness-fish'), ...KEY_ALIAS_LINES].join(
        '\n',
      ),
    );
  });

  it("connect-39: Hosts agentfwd and agentfwd-off log in to harness with the run key and forward the run's agent by its path", () => {
    deepStrictEqual(
      ['agentfwd', 'agentfwd-off'].map(alias => accountBlock(alias)),
      ['agentfwd', 'agentfwd-off'].map(alias =>
        [
          ...sharedLines(alias, 'harness').map(line =>
            line === '  IdentityAgent none'
              ? '  IdentityAgent /run/agent.sock'
              : line,
          ),
          ...KEY_ALIAS_LINES,
          '  ForwardAgent /run/agent.sock',
        ].join('\n'),
      ),
    );
  });

  it('connect-39: Host x11fwd logs in to harness with the run key and forwards X11 as trusted', () => {
    strictEqual(
      accountBlock('x11fwd'),
      [
        ...sharedLines('x11fwd', 'harness'),
        ...KEY_ALIAS_LINES,
        '  ForwardX11 yes',
        '  ForwardX11Trusted yes',
      ].join('\n'),
    );
  });

  it('coverage-19: Host badkey logs in to the harness host with a key the host does not accept', () => {
    strictEqual(
      accountBlock('badkey'),
      [
        'Host badkey',
        '  HostName 127.0.0.1',
        '  Port 49153',
        '  User harness',
        '  IdentityFile /run/id_unauthorised',
        '  IdentitiesOnly yes',
        '  BatchMode yes',
        '  StrictHostKeyChecking accept-new',
        '  UserKnownHostsFile /run/known_hosts',
      ].join('\n'),
    );
  });

  it('coverage-19: Host 127.0.0.2 reaches the loopback with a refused key and has no user and no port', () => {
    strictEqual(
      accountBlock('127.0.0.2'),
      [
        'Host 127.0.0.2',
        '  HostName 127.0.0.1',
        '  BatchMode yes',
        '  IdentitiesOnly yes',
        '  IdentityFile /run/id_unauthorised',
        '  StrictHostKeyChecking accept-new',
        '  UserKnownHostsFile /run/known_hosts',
      ].join('\n'),
    );
  });

  it('D-85: Host mute logs in to harness-mute with the run key', () => {
    strictEqual(
      accountBlock('mute'),
      [...sharedLines('mute', 'harness-mute'), ...KEY_ALIAS_LINES].join('\n'),
    );
  });

  it('#670: Host i686 logs in to harness-i686 with the run key', () => {
    strictEqual(
      accountBlock('i686'),
      [...sharedLines('i686', 'harness-i686'), ...KEY_ALIAS_LINES].join('\n'),
    );
  });

  for (const alias of [
    'harness-bash',
    'harness-zsh',
    'harness-dash',
    'harness-ksh',
    'harness-csh',
    'harness-tcsh',
  ]) {
    it(`F-2704: Host ${alias} logs in to ${alias} with the run key`, () => {
      strictEqual(
        accountBlock(alias),
        [...sharedLines(alias, alias), ...KEY_ALIAS_LINES].join('\n'),
      );
    });
  }

  it('#668: Host readonly logs in to harness-ro with the run key', () => {
    strictEqual(
      accountBlock('readonly'),
      [...sharedLines('readonly', 'harness-ro'), ...KEY_ALIAS_LINES].join('\n'),
    );
  });

  it('coverage-16: the control sockets of the master aliases are in the control folder when it is not the run folder', () => {
    deepStrictEqual(
      ['master', 'master-ask', 'master-yes', 'master-autoask'].map(alias =>
        harnessSshConfig(
          49153,
          '/run',
          '/run/agent.sock',
          ROUTED_ADDRESS,
          '/tmp/control-x',
        )
          .split('\n\n')
          .find(block => block.startsWith(`Host ${alias}\n`))
          ?.split('\n')
          .find(line => line.includes('ControlPath')),
      ),
      [
        '  ControlPath /tmp/control-x/cm-%C',
        '  ControlPath /tmp/control-x/cm-ask-%C',
        '  ControlPath /tmp/control-x/cm-yes-%C',
        '  ControlPath /tmp/control-x/cm-autoask-%C',
      ],
    );
  });

  it('D-85: Host master is the password account behind a ControlMaster that starts on demand', () => {
    strictEqual(
      accountBlock('master'),
      [
        ...sharedLines('master', 'harness-pw'),
        ...PASSWORD_ALIAS_LINES,
        '  ControlMaster auto',
        '  ControlPath /run/cm-%C',
        '  ControlPersist 600',
      ].join('\n'),
    );
  });

  it('D-85: Host master-ask is the password account behind a ControlMaster that asks first', () => {
    strictEqual(
      accountBlock('master-ask'),
      [
        ...sharedLines('master-ask', 'harness-pw'),
        ...PASSWORD_ALIAS_LINES,
        '  ControlMaster ask',
        '  ControlPath /run/cm-ask-%C',
        '  ControlPersist 600',
      ].join('\n'),
    );
  });

  for (const [alias, mode] of [
    ['master-yes', 'yes'],
    ['master-autoask', 'autoask'],
  ] as const) {
    it(`coverage-16: Host ${alias} is the password account behind a ControlMaster that is ${mode}`, () => {
      strictEqual(
        accountBlock(alias),
        [
          ...sharedLines(alias, 'harness-pw'),
          ...PASSWORD_ALIAS_LINES,
          `  ControlMaster ${mode}`,
          `  ControlPath /run/cm-${mode}-%C`,
          '  ControlPersist 600',
        ].join('\n'),
      );
    });
  }

  it("gives the editor's user settings the harness ssh_config as remote.SSH.configFile", () => {
    writeUserSettings(workspace.root, '/run/ssh_config');
    deepStrictEqual(
      JSON.parse(
        readFileSync(
          path.join(workspace.root, 'user-data', 'User', 'settings.json'),
          'utf8',
        ),
      ),
      {'remote.SSH.configFile': '/run/ssh_config'},
    );
  });

  it('coverage-12: a settings tail goes after the last member, with no comma before it, so that the editor reads what comes before it', () => {
    writeUserSettings(
      workspace.root,
      '/run/ssh_config',
      {'remote.SSH.useLocalServer': false},
      undefined,
      '"acceptance.broken": 1 "acceptance.brokenToo": 2',
    );
    strictEqual(
      readFileSync(
        path.join(workspace.root, 'user-data', 'User', 'settings.json'),
        'utf8',
      ),
      '{\n  "remote.SSH.configFile": "/run/ssh_config",\n  "remote.SSH.useLocalServer": false\n  "acceptance.broken": 1 "acceptance.brokenToo": 2\n}\n',
    );
  });

  describe('markDownloadRequests (card coverage-17)', () => {
    it('coverage-17: a launch notes how many requests the download host had logged when it began', () => {
      workspace.write('requests.log', 'a GET /ok/x\nb GET /missing/y\n');
      markDownloadRequests(workspace.root, 'install-probe', {
        HARNESS_DOWNLOADS_LOG: path.join(workspace.root, 'requests.log'),
      });
      strictEqual(
        readFileSync(
          path.join(workspace.root, 'install-probe-requests-start'),
          'utf8',
        ),
        '2\n',
      );
    });

    it('coverage-17: a log not written yet counts no request', () => {
      markDownloadRequests(workspace.root, 'install-probe', {
        HARNESS_DOWNLOADS_LOG: path.join(workspace.root, 'none.log'),
      });
      strictEqual(
        readFileSync(
          path.join(workspace.root, 'install-probe-requests-start'),
          'utf8',
        ),
        '0\n',
      );
    });

    it('coverage-17: a run without a download host notes nothing', () => {
      markDownloadRequests(workspace.root, 'install-probe', {});
      strictEqual(
        existsSync(path.join(workspace.root, 'install-probe-requests-start')),
        false,
      );
    });
  });

  describe('packagedExtensions', () => {
    it('finds the VSIX of each extension under test and no other', () => {
      workspace.write('dist/remote-ssh-0.0.0.vsix', '');
      workspace.write('dist/remote-ssh-edit-0.0.0.vsix', '');
      workspace.write('dist/remote-wsl-0.0.0.vsix', '');
      deepStrictEqual(packagedExtensions(workspace.root), [
        path.join(workspace.root, 'dist', 'remote-ssh-0.0.0.vsix'),
        path.join(workspace.root, 'dist', 'remote-ssh-edit-0.0.0.vsix'),
      ]);
    });

    it('finds none before anything is packaged', () => {
      deepStrictEqual(packagedExtensions(workspace.root), []);
    });

    it('tooling-30: the run-wide set leaves the explorer out', () => {
      workspace.write('dist/remote-ssh-0.0.0.vsix', '');
      workspace.write('dist/remote-explorer-0.0.0.vsix', '');
      deepStrictEqual(packagedExtensions(workspace.root), [
        path.join(workspace.root, 'dist', 'remote-ssh-0.0.0.vsix'),
      ]);
    });
  });

  describe('installsOf (card tooling-30)', () => {
    it('tooling-30, containers-09, connect-84: the run installs once into its folder, once into each explorer and containers launch’s folder with its own extension, and once into each genuine launch’s folder', () => {
      workspace.write('dist/remote-explorer-0.0.0.vsix', '');
      workspace.write('dist/remote-containers-0.1.0.vsix', '');
      deepStrictEqual(
        installsOf(
          workspace.root,
          '/run',
          ['/dist/remote-ssh.vsix', '/run/window-agent.vsix'],
          launchesOf(REPOSITORY_ROOT),
        ),
        [
          {
            folder: path.join('/run', 'extensions'),
            files: ['/dist/remote-ssh.vsix', '/run/window-agent.vsix'],
            client: 'vscodium',
          },
          ...[
            'explorer',
            'explorer-alone',
            'explorer-no-proposals',
            'explorer-standdown',
          ].map(label => ({
            folder: path.join('/run', `extensions-${label}`),
            files: [
              '/dist/remote-ssh.vsix',
              '/run/window-agent.vsix',
              path.join(workspace.root, 'dist', 'remote-explorer-0.0.0.vsix'),
            ],
            client: 'vscodium',
          })),
          ...[
            'containers',
            'containers-standdown',
            'containers-no-proposals',
            'containers-trust',
            'containers-volume',
          ].map(label => ({
            folder: path.join('/run', `extensions-${label}`),
            files: [
              '/dist/remote-ssh.vsix',
              '/run/window-agent.vsix',
              path.join(workspace.root, 'dist', 'remote-containers-0.1.0.vsix'),
            ],
            client: 'vscodium',
          })),
          {
            folder: path.join('/run', 'extensions-containers-explorer'),
            files: [
              '/dist/remote-ssh.vsix',
              '/run/window-agent.vsix',
              path.join(workspace.root, 'dist', 'remote-containers-0.1.0.vsix'),
              path.join(workspace.root, 'dist', 'remote-explorer-0.0.0.vsix'),
            ],
            client: 'vscodium',
          },
          {
            folder: path.join('/run', 'extensions-containers-ports'),
            files: [
              '/dist/remote-ssh.vsix',
              '/run/window-agent.vsix',
              path.join(workspace.root, 'dist', 'remote-containers-0.1.0.vsix'),
            ],
            client: 'vscodium',
          },
          ...['genuine', 'ssh-no-proposals'].map(label => ({
            folder: path.join('/run', `extensions-${label}`),
            files: ['/dist/remote-ssh.vsix', '/run/window-agent.vsix'],
            client: 'vscode',
          })),
        ],
      );
    });

    it('tooling-30: an explorer that is not packaged yet is skipped, as the run-wide set skips one', () => {
      deepStrictEqual(
        installsOf(
          workspace.root,
          '/run',
          ['/a.vsix'],
          [
            {
              label: 'explorer',
              kind: 'plain',
              suite: 'explorer',
              withExtensions: [
                'remote-oss.remote-explorer',
                'remote-oss.unknown',
              ],
            },
          ],
        )[1]?.files,
        ['/a.vsix'],
      );
    });
  });

  describe('runAcceptance', () => {
    it('tooling-50: a run given labels makes only those launches, in the run order', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium', [
        'remote',
        'local',
      ]);
      deepStrictEqual(harness.launched, ['local', 'remote']);
    });

    it('containers-59: a run whose chosen launches ask for no registry starts none', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium', ['local']);
      deepStrictEqual(
        [
          harness.calls.filter(call => call.startsWith('registry')),
          harness.variables?.HARNESS_REGISTRY,
        ],
        [[], undefined],
      );
    });

    it('containers-59: a run with the containers launch starts the registry once, passes its address, and stops it at the end', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium', ['containers']);
      deepStrictEqual(
        [
          harness.calls.filter(call => call.startsWith('registry')),
          harness.variables?.HARNESS_REGISTRY,
        ],
        [
          [
            `registry started ${acceptanceRunId(process.env, process.pid)}`,
            'registry stopped',
          ],
          '127.0.0.1:5000',
        ],
      );
    });

    it('tooling-51: a run given the genuine label makes it, with VS Code downloaded once and its folder installed with VS Code’s CLI', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium', ['genuine']);
      deepStrictEqual(
        [
          harness.launched,
          harness.calls.filter(call => call === 'vscode executable').length,
          harness.calls.filter(
            call =>
              call.startsWith('/vscode/bin/code ') &&
              call.includes(
                `--extensions-dir=${path.join(harness.runFolder, 'extensions-genuine')}`,
              ),
          ).length,
          harness.variables?.HARNESS_VSCODE_EXECUTABLE,
        ],
        [['genuine'], 1, 1, '/vscode/code'],
      );
    });

    it('tooling-51: a run that does not name the genuine label never downloads VS Code, installs for it or makes it', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium', ['local']);
      deepStrictEqual(
        [
          harness.launched,
          harness.calls.filter(call => call === 'vscode executable'),
          harness.calls.filter(call => call.includes('extensions-genuine')),
          harness.variables?.HARNESS_VSCODE_EXECUTABLE,
        ],
        [['local'], [], [], undefined],
      );
    });

    it('tooling-51: a run with no labels leaves the genuine launch out', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(harness.launched.includes('genuine'), false);
    });

    it('tooling-50: an unknown label fails with 2 before anything starts', async () => {
      const code = await runAcceptance(workspace.root, harness, 'vscodium', [
        'local',
        'no-such-launch',
      ]);
      deepStrictEqual([code, harness.calls], [2, []]);
    });

    it('tooling-50: no launch reachable makes nothing and passes', async () => {
      const code = await runAcceptance(workspace.root, harness, 'vscodium', []);
      deepStrictEqual([code, harness.calls, harness.launched], [0, [], []]);
    });

    it('#439: the run removes the suite bundles when it ends', async () => {
      workspace.write('tests/acceptance/dist-remote/window.test.cjs', '');
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(
        existsSync(path.join(workspace.root, 'tests/acceptance/dist-remote')),
        false,
      );
    });

    it('builds the host, starts it with the run key, waits for SSH, bundles and runs the tests', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        harness.calls.map(call => call.split(' ').slice(0, 2).join(' ')),
        [
          'docker build',
          'ssh-keygen -q',
          'docker run',
          'docker port',
          'docker network',
          'docker network',
          'docker network',
          'docker inspect',
          'ssh -F',
          'bundle suite',
          `docker rm`,
        ],
      );
    });

    it("tooling-47: the host joins the run's own network once it runs, and its address there is read from it", async () => {
      await runAcceptance(workspace.root, harness);
      const network = `remote-oss-acceptance-${acceptanceRunId(process.env, process.pid)}`;
      const started = harness.calls.findIndex(call =>
        call.startsWith('docker run'),
      );
      const joined = harness.calls.findIndex(
        call => call === `docker network connect ${network} ${CONTAINER}`,
      );
      const addressed = harness.calls.findIndex(
        call =>
          call.startsWith('docker inspect --format') &&
          call.includes(`Networks "${network}"`) &&
          call.endsWith(CONTAINER),
      );
      deepStrictEqual(
        [started >= 0, joined > started, addressed > joined],
        [true, true, true],
      );
    });

    it("names the run's folder after the run's id, so that a clean-up finds a killed run's editor", async () => {
      await runAcceptance(workspace.root, harness);
      strictEqual(
        path
          .basename(harness.runFolder)
          .startsWith(
            `acceptance-${acceptanceRunId(process.env, process.pid)}-`,
          ),
        true,
      );
    });

    it("passes the harness variables to the tests, the run's id among them (containers-09)", async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(harness.variables, {
        REMOTE_OSS_ACCEPTANCE: '1',
        HARNESS_SSH_CONFIG: path.join(harness.runFolder, 'ssh_config'),
        HARNESS_CONTAINER: CONTAINER,
        HARNESS_ROUTED_ADDRESS: ROUTED_ADDRESS,
        HARNESS_RUN_FOLDER: harness.runFolder,
        HARNESS_RUN_ID: acceptanceRunId(process.env, process.pid),
        HARNESS_PASSWORD_FILE: path.join(harness.runFolder, 'password'),
        REMOTE_OSS_ACCEPTANCE_SCRIPT: path.join(
          harness.runFolder,
          'script.json',
        ),
        REMOTE_OSS_ACCEPTANCE_RECORD: path.join(
          harness.runFolder,
          'record.jsonl',
        ),
        REMOTE_OSS_ACCEPTANCE_SIGNALS: path.join(harness.runFolder, 'signals'),
        HARNESS_VSIX_FILES: '',
        HARNESS_EDITOR: 'vscode',
        REMOTE_OSS_ACCEPTANCE_LOG: path.join(harness.runFolder, 'log.txt'),
      });
    });

    it("installs the packaged VSIX into the run's own extensions folder before the tests, with the run's user and shared data", async () => {
      workspace.write('dist/remote-ssh-edit-0.0.0.vsix', '');
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        harness.calls.filter(call => call.startsWith('code ')),
        [
          [
            'code',
            `--extensions-dir=${path.join(harness.runFolder, 'extensions')}`,
            `--user-data-dir=${path.join(harness.runFolder, 'user-data')}`,
            `--shared-data-dir=${path.join(harness.runFolder, 'shared-data')}`,
            '--install-extension',
            path.join(workspace.root, 'dist', 'remote-ssh-edit-0.0.0.vsix'),
          ].join(' '),
        ],
      );
    });

    it("returns the tests' exit code", async () => {
      harness.testResult = {exitCode: 3, output: ''};
      strictEqual(await runAcceptance(workspace.root, harness), 3);
    });

    it('removes the container and the run folder after the tests', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [harness.calls.at(-1), existsSync(harness.runFolder)],
        [`docker rm --force ${CONTAINER}`, false],
      );
    });

    it('retries SSH half a second apart until the host accepts', async () => {
      harness.sshFailures = 2;
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(harness.sleeps, [500, 500]);
    });

    it('fails when the host never accepts SSH, and still removes the container', async () => {
      harness.sshFailures = 40;
      const status = await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [status, harness.calls.at(-1)],
        [1, `docker rm --force ${CONTAINER}`],
      );
    });

    it('fails when the image does not build, with no container to remove', async () => {
      harness.answers.set('docker build', {
        status: 1,
        stdout: '',
        stderr: 'no daemon',
      });
      const status = await runAcceptance(workspace.root, harness);
      deepStrictEqual([status, harness.calls.length], [1, 1]);
    });

    it('prints the cause of an empty error and returns 1', async () => {
      harness.bundleSuiteError = new Error('', {cause: 'no space'});
      const lines: string[] = [];
      const previousError = console.error;
      console.error = (line: unknown) => lines.push(String(line));
      try {
        const status = await runAcceptance(workspace.root, harness);
        deepStrictEqual([status, lines], [1, ['acceptance: no space']]);
      } finally {
        console.error = previousError;
      }
    });
  });

  describe('runLaunches', () => {
    const BASE = {'remote.SSH.configFile': '/run/ssh_config'};
    const TERMINAL: Launch = {
      label: 'terminal',
      runner: 'runner-remote',
      suite: 'suite-terminal',
      settings: {'remote.SSH.useLocalServer': false},
    };
    const REMOTE: Launch = {
      label: 'remote',
      runner: 'runner-remote',
      suite: 'suite-remote',
    };

    /** The editor's user settings file of the run. */
    function settingsPath(): string {
      return path.join(workspace.root, 'user-data', 'User', 'settings.json');
    }

    /** The user settings as the editor would read them now. */
    function settingsFile(): unknown {
      return JSON.parse(readFileSync(settingsPath(), 'utf8'));
    }

    /** A command runner that records its calls and succeeds, for the host setup of a launch. */
    function recordingCommand(): {calls: string[]; command: CommandRunner} {
      const calls: string[] = [];
      function command(
        program: string,
        programArguments: readonly string[],
      ): CommandResult {
        calls.push([program, ...programArguments].join(' '));
        return {status: 0, stdout: '', stderr: ''};
      }
      return {calls, command};
    }

    /** A sleeper that records its waits. */
    function recordingSleeper(): {waits: number[]; sleep: Sleeper} {
      const waits: number[] = [];
      function sleep(milliseconds: number): Promise<void> {
        waits.push(milliseconds);
        return Promise.resolve();
      }
      return {waits, sleep};
    }

    /** The user settings each launch found when it started, by label. */
    async function settingsSeen(
      ...launches: Launch[]
    ): Promise<Map<string, unknown>> {
      const seen = new Map<string, unknown>();
      const {command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        launches,
        command,
        '',
        sleep,
        launch => {
          seen.set(launch?.label ?? '', settingsFile());
          return Promise.resolve({exitCode: 0, output: ''});
        },
      );
      return seen;
    }

    it('qa-01: each launch is announced with its label before it runs, so a log splits at it', async () => {
      const reported: string[] = [];
      const {command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [TERMINAL, REMOTE, undefined],
        command,
        '',
        sleep,
        launch => {
          reported.push(`ran ${launch?.label ?? 'the one configuration'}`);
          return Promise.resolve({exitCode: 0, output: ''});
        },
        () => Promise.resolve(),
        {},
        () => Promise.resolve({release: () => Promise.resolve()}),
        line => {
          reported.push(line);
        },
      );
      deepStrictEqual(reported, [
        'acceptance: launch terminal',
        'ran terminal',
        'acceptance: launch remote',
        'ran remote',
        'ran the one configuration',
      ]);
    });

    it("each launch runs the helper stop program on the run's user-data folder once it has run, when it holds records", async () => {
      const userData = path.join(workspace.root, 'user-data');
      const namespaceFolder = path.join(
        userData,
        'User',
        'globalStorage',
        'ext.a',
        'registry',
        'watch',
      );
      mkdirSync(namespaceFolder, {recursive: true});
      writeFileSync(
        path.join(
          namespaceFolder,
          `${createHash('sha256').update('one').digest('hex').slice(0, 32)}.json`,
        ),
        JSON.stringify({
          namespace: 'watch',
          recordKey: 'one',
          nonce: 'n1',
          endpoint: '/run/one.sock',
        }),
      );
      const {calls, command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [TERMINAL, REMOTE],
        command,
        '',
        sleep,
        launch => {
          calls.push(`ran ${launch?.label ?? ''}`);
          return Promise.resolve({exitCode: 0, output: ''});
        },
      );
      const stopLine = [process.execPath, STOP_PROGRAM, userData].join(' ');
      deepStrictEqual(
        calls.filter(call => call.startsWith('ran ') || call === stopLine),
        ['ran terminal', stopLine, 'ran remote', stopLine],
      );
    });

    it('D-85: a launch with settings finds them over the base settings', async () => {
      deepStrictEqual((await settingsSeen(TERMINAL, REMOTE)).get('terminal'), {
        ...BASE,
        'remote.SSH.useLocalServer': false,
      });
    });

    it('D-85: the launch after one with settings finds only the base settings', async () => {
      deepStrictEqual(
        (await settingsSeen(TERMINAL, REMOTE)).get('remote'),
        BASE,
      );
    });

    it("D-85: a launch's own remote.SSH.configFile is the one written", async () => {
      const seen = await settingsSeen({
        ...REMOTE,
        settings: {'remote.SSH.configFile': '/elsewhere'},
      });
      deepStrictEqual(seen.get('remote'), {
        'remote.SSH.configFile': '/elsewhere',
      });
    });

    it('D-85: a retried launch finds the base settings again, not what the failed attempt left', async () => {
      const seen: unknown[] = [];
      let attempts = 0;
      const {command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [TERMINAL],
        command,
        '',
        sleep,
        () => {
          attempts += 1;
          seen.push(settingsFile());
          writeFileSync(settingsPath(), '{"left": "behind"}');
          return Promise.resolve({
            exitCode: attempts === 1 ? 1 : 0,
            output: attempts === 1 ? 'CodeWindow: detected unresponsive' : '',
          });
        },
      );
      deepStrictEqual(seen[1], seen[0]);
    });

    /** A holder of ports that records what it was asked and what it let go, and fails for a port it is told is taken. */
    function recordingHolder(taken: readonly number[] = []): {
      events: string[];
      holdPorts: PortHolder;
    } {
      const events: string[] = [];
      return {
        events,
        holdPorts: ports => {
          const blocked = ports.find(port => taken.includes(port));
          if (blocked !== undefined) {
            return Promise.reject(
              new Error(
                `the client listener on 127.0.0.1:${String(blocked)} could not start: in use`,
              ),
            );
          }
          events.push(`hold ${ports.join(',')}`);
          return Promise.resolve({
            release: () => {
              events.push('release');
              return Promise.resolve();
            },
          });
        },
      };
    }

    /** Runs `launches` with the recording holder; `during` runs inside each attempt. */
    async function withHolder(
      launches: Launch[],
      holder: ReturnType<typeof recordingHolder>,
      during: () => AttemptResult | Promise<AttemptResult> = () => ({
        exitCode: 0,
        output: '',
      }),
    ): Promise<void> {
      const {command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        launches,
        command,
        '',
        sleep,
        () => {
          holder.events.push('attempt');
          return Promise.resolve(during());
        },
        () => Promise.resolve(),
        {},
        holder.holdPorts,
      );
    }

    it('#680: a launch with client listeners holds them during the attempt and lets them go after', async () => {
      const holder = recordingHolder();
      await withHolder([{...REMOTE, clientListeners: [41060, 41061]}], holder);
      deepStrictEqual(holder.events, [
        'hold 41060,41061',
        'attempt',
        'release',
      ]);
    });

    it('#680: an attempt that fails still lets the client listeners go', async () => {
      const holder = recordingHolder();
      await withHolder([{...REMOTE, clientListeners: [41060]}], holder, () => {
        throw new Error('the attempt broke');
      }).catch(() => undefined);
      deepStrictEqual(holder.events, ['hold 41060', 'attempt', 'release']);
    });

    it('#680: a client port that is taken fails the attempt with a message naming it, and starts no editor', async () => {
      const holder = recordingHolder([41061]);
      let message = '';
      await withHolder(
        [{...REMOTE, clientListeners: [41060, 41061]}],
        holder,
      ).catch((caught: unknown) => {
        message = caught instanceof Error ? caught.message : String(caught);
      });
      deepStrictEqual(
        [message, holder.events],
        ['the client listener on 127.0.0.1:41061 could not start: in use', []],
      );
    });

    it('#680: a launch without client listeners opens nothing', async () => {
      const holder = recordingHolder();
      await withHolder([REMOTE], holder);
      deepStrictEqual(holder.events, ['hold ', 'attempt', 'release']);
    });

    it('D-85: the VS Code run starts its one configuration without a label and writes no settings', async () => {
      const labels: Array<string | undefined> = [];
      const {command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [undefined],
        command,
        '',
        sleep,
        launch => {
          labels.push(launch?.label);
          return Promise.resolve({exitCode: 0, output: ''});
        },
      );
      deepStrictEqual(
        [
          labels,
          existsSync(path.join(workspace.root, 'user-data', 'User')),
          readdirSync(workspace.root).filter(name =>
            name.endsWith('-settings.json'),
          ),
        ],
        [[undefined], false, []],
      );
    });

    const PORTS: Launch = {
      label: 'ports-probe',
      runner: 'runner-remote',
      suite: 'suite-ports',
      settings: {
        'remote.SSH.serverPickPortsFromRange': {harness: '45000-45010'},
      },
      hostSetup: [
        {command: "pkill -f 'n[c] -lk -p'; true"},
        {command: 'nc -lk -p 45000 -s 127.0.0.1 -e /bin/true', detach: true},
      ],
    };

    it('coverage-13: a launch with host setup runs it in order, as root, before its window starts', async () => {
      const order: string[] = [];
      function command(
        program: string,
        programArguments: readonly string[],
      ): CommandResult {
        order.push([program, ...programArguments].join(' '));
        return {status: 0, stdout: '', stderr: ''};
      }
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [PORTS, REMOTE],
        command,
        'c0ffee',
        sleep,
        launch => {
          order.push(`launch:${launch?.label ?? ''}`);
          return Promise.resolve({exitCode: 0, output: ''});
        },
      );
      deepStrictEqual(
        [
          order.filter(call => call.startsWith('docker')),
          order.indexOf('launch:ports-probe'),
        ],
        [
          [
            "docker exec --user root c0ffee sh -c pkill -f 'n[c] -lk -p'; true",
            'docker exec -d --user root c0ffee sh -c nc -lk -p 45000 -s 127.0.0.1 -e /bin/true',
          ],
          2,
        ],
      );
    });

    it('coverage-13: a launch with host setup waits the helper grace after the previous launch, and a launch without does not', async () => {
      const {command} = recordingCommand();
      const {waits, sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [REMOTE, PORTS],
        command,
        '',
        sleep,
        () => Promise.resolve({exitCode: 0, output: ''}),
      );
      deepStrictEqual(waits, [FRESH_RESOLVE_WAIT_MILLISECONDS]);
    });

    it('coverage-13: a failing host setup fails the attempt with its command and its output', async () => {
      function command(program: string): CommandResult {
        return program === 'docker'
          ? {status: 1, stdout: '', stderr: 'setup broke'}
          : {status: 0, stdout: '', stderr: ''};
      }
      const {sleep} = recordingSleeper();
      await rejects(
        runLaunches(
          workspace.root,
          '/run/ssh_config',
          [PORTS],
          command,
          'c0ffee',
          sleep,
          () => Promise.resolve({exitCode: 0, output: ''}),
        ),
        /host setup failed: pkill -f 'n\[c\] -lk -p'; true\nsetup broke/,
      );
    });

    it('coverage-13: a launch with a label writes the same bytes to its own settings file', async () => {
      const {command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [PORTS],
        command,
        '',
        sleep,
        () => Promise.resolve({exitCode: 0, output: ''}),
      );
      strictEqual(
        readFileSync(
          path.join(workspace.root, 'user-data', 'User', 'settings.json'),
          'utf8',
        ),
        readFileSync(
          path.join(workspace.root, 'ports-probe-settings.json'),
          'utf8',
        ),
      );
    });

    it("coverage-17: a launch's settings get the download host's bases, and the product's placeholders stay", async () => {
      const {command} = recordingCommand();
      const {sleep} = recordingSleeper();
      await runLaunches(
        workspace.root,
        '/run/ssh_config',
        [
          {
            ...PORTS,
            label: 'install-probe',
            settings: {
              'remote.SSH.serverDownloadUrlTemplate':
                '${HARNESS_DOWNLOADS_LOCAL}/ok/${os}-${arch}/${commit}',
            },
          },
        ],
        command,
        '',
        sleep,
        () => Promise.resolve({exitCode: 0, output: ''}),
        () => Promise.resolve(),
        {HARNESS_DOWNLOADS_LOCAL: 'http://127.0.0.1:9'},
      );
      strictEqual(
        (
          JSON.parse(
            readFileSync(
              path.join(workspace.root, 'install-probe-settings.json'),
              'utf8',
            ),
          ) as Record<string, string>
        )['remote.SSH.serverDownloadUrlTemplate'],
        'http://127.0.0.1:9/ok/${os}-${arch}/${commit}',
      );
    });

    it('coverage-13: the fresh-resolve wait is the extension helper grace', () => {
      const bounds = readFileSync(
        path.join(
          REPOSITORY_ROOT,
          'packages',
          'remote-ssh',
          'src',
          'pipeline',
          'bounds.ts',
        ),
        'utf8',
      );
      strictEqual(
        FRESH_RESOLVE_WAIT_MILLISECONDS,
        Number(/HELPER_GRACE_MILLISECONDS = (\d+)/.exec(bounds)?.[1]),
      );
    });
  });

  describe('withOneRetry', () => {
    it('returns the step result without sleeping or reporting when the step resolves', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep(['ok']);
      const result = await withOneRetry(step, recorder.sleep, recorder.report);
      deepStrictEqual(
        [result, recorder.sleeps, recorder.lines],
        ['ok', [], []],
      );
    });

    it('returns the retry result when the first attempt rejects', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), 'ok']);
      const result = await withOneRetry(step, recorder.sleep, recorder.report);
      strictEqual(result, 'ok');
    });

    it('sleeps the retry pause before the one retry', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), 'ok']);
      await withOneRetry(step, recorder.sleep, recorder.report);
      deepStrictEqual(recorder.sleeps, [RETRY_PAUSE_MILLISECONDS]);
    });

    it('reports the failure and the pause in seconds before the one retry', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), 'ok']);
      await withOneRetry(step, recorder.sleep, recorder.report);
      deepStrictEqual(recorder.lines, [
        'acceptance: busy; retrying once in 5 s',
      ]);
    });

    it('rejects with the second error when the retry rejects too', async () => {
      const recorder = new RetryRecorder();
      const {step} = scriptedStep([new Error('busy'), new Error('down')]);
      await rejects(
        withOneRetry(step, recorder.sleep, recorder.report),
        /down/,
      );
    });

    it('runs the step once more after a rejection, and no more', async () => {
      const recorder = new RetryRecorder();
      const {step, called} = scriptedStep([
        new Error('busy'),
        new Error('busy'),
      ]);
      let rejected = false;
      try {
        await withOneRetry(step, recorder.sleep, recorder.report);
      } catch {
        rejected = true;
      }
      deepStrictEqual([called(), rejected], [2, true]);
    });
  });

  describe('failureText', () => {
    it('returns the message of an error that has one', () => {
      strictEqual(failureText(new Error('boom')), 'boom');
    });

    it('returns the cause message when the message is empty and the cause is an error', () => {
      strictEqual(
        failureText(new Error('', {cause: new Error('ECONNRESET')})),
        'ECONNRESET',
      );
    });

    it('returns the cause text when the message is empty and the cause is not an error', () => {
      strictEqual(
        failureText(new Error('', {cause: 'socket hang up'})),
        'socket hang up',
      );
    });

    it('returns the first two stack lines, trimmed and joined, for an empty message without a cause', () => {
      const error = new Error('');
      error.stack =
        'Error\n    at a (x.js:1:1)\n    at b (y.js:2:2)\n    at c (z.js:3:3)';
      strictEqual(failureText(error), 'Error at a (x.js:1:1)');
    });

    it('returns the error name when the message is empty and there is no cause or stack', () => {
      const error = new Error('');
      delete error.stack;
      strictEqual(failureText(error), 'Error');
    });

    it('returns the string of a non-error', () => {
      strictEqual(failureText(42), '42');
    });
  });

  describe('acceptanceConfiguration', () => {
    it('runs the floor editor with a fresh profile and the proposed API of the extensions under test', () => {
      const configuration = acceptanceConfiguration('/repo', {
        HARNESS_RUN_FOLDER: '/run',
        HARNESS_VSIX_FILES: '',
      });
      deepStrictEqual(
        [configuration.version, configuration.launchArgs],
        [
          '1.139.1',
          [
            '--user-data-dir=/run/user-data',
            '--shared-data-dir=/run/shared-data',
            '--extensions-dir=/run/extensions',
            '--enable-proposed-api=remote-oss.remote-ssh',
            '--enable-proposed-api=remote-oss.acceptance-window-agent',
            '--disable-workspace-trust',
          ],
        ],
      );
    });

    it('passes the harness variables to the extension host', () => {
      strictEqual(
        acceptanceConfiguration('/repo', {HARNESS_CONTAINER: CONTAINER}).env
          .HARNESS_CONTAINER,
        CONTAINER,
      );
    });
  });

  describe('the VSCodium run', () => {
    const EXECUTABLE = '/vscodium/codium-insiders';
    const LAUNCH: RunnerLaunch = {
      label: 'extra',
      runner: 'runner',
      suite: 'suite-extra',
    };
    const CONFIGURATION_ENVIRONMENT = {HARNESS_RUN_FOLDER: '/run'};

    /** The configurations of the run, from the workspace's failure cases. */
    function configurations() {
      return vscodiumConfigurations(
        workspace.root,
        CONFIGURATION_ENVIRONMENT,
        EXECUTABLE,
      );
    }

    it('#253 Q14: with no editor the VSCodium executable is not asked for, and the VS Code CLI installs the VSIX files', async () => {
      workspace.write('dist/remote-ssh-0.0.0.vsix', '');
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [
          harness.calls.includes('vscodium executable'),
          harness.calls.some(call => call.startsWith('code ')),
        ],
        [false, true],
      );
    });

    it('coverage-31: an attempt after one that deleted the vanishing client finds it rewritten', async () => {
      workspace.write(
        'tests/acceptance/suite-client/cases.json',
        JSON.stringify({
          cases: [
            {
              label: 'client-vanishing',
              cite: 'F-2101 AC-19',
              setting: '<run>/clients/vanishing/ssh',
              checked: ['vanishing/ssh'],
              used: null,
            },
          ],
        }),
      );
      harness.labelResults.set('client-vanishing', {
        exitCode: 1,
        output: 'CodeWindow: detected unresponsive',
      });
      const status = await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        [
          status,
          harness.clientLaunches
            .filter(each => each.label === 'client-vanishing')
            .map(each => each.vanishing),
        ],
        [1, [true, true]],
      );
    });

    it('tooling-27: the VSCodium run starts the download host before the harness host, which gets its names', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      const started = harness.calls.indexOf('downloads started');
      const containerRun = harness.calls.findIndex(call =>
        call.startsWith('docker run'),
      );
      deepStrictEqual(
        [
          started >= 0 && started < containerRun,
          harness.calls[containerRun]?.includes(
            '--add-host downloads:host-gateway --add-host update.code.visualstudio.com:host-gateway',
          ),
        ],
        [true, true],
      );
    });

    it("containers-09: the VSCodium run sweeps other runs' stale dev containers, then builds the run's dev container image, and passes its tag", async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      const sweep = harness.calls.indexOf(
        'docker ps --all --quiet --filter label=remote-oss.acceptance.devcontainer=1',
      );
      const build = harness.calls.findIndex(
        call =>
          call.startsWith('docker build') &&
          call.endsWith(
            path.join(
              workspace.root,
              'tests',
              'acceptance',
              'devcontainer-image',
            ),
          ),
      );
      deepStrictEqual(
        [
          sweep >= 0 && sweep < build,
          harness.variables?.HARNESS_DEVCONTAINER_IMAGE,
        ],
        [
          true,
          `remote-oss-acceptance-devcontainer:${acceptanceRunId(process.env, process.pid)}`,
        ],
      );
    });

    it('containers-09: the VS Code run builds no dev container image and puts no stand-in in', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [
          harness.calls.some(call => call.includes('devcontainer')),
          harness.variables?.HARNESS_DEVCONTAINER_IMAGE,
        ],
        [false, undefined],
      );
    });

    it("containers-09: the stand-in of containers-standdown goes into that launch's own extensions folder, a manifest with the other extension's id, listed after the editor's own entry", async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      const location = path.join(
        harness.runFolder,
        'extensions-containers-standdown',
        'ms-vscode-remote.remote-containers-0.0.0',
      );
      deepStrictEqual(harness.standInFound.get('containers-standdown'), [
        {
          publisher: 'ms-vscode-remote',
          name: 'remote-containers',
          version: '0.0.0',
          engines: {vscode: '^1.139.0'},
          displayName: 'Acceptance stand-in (not the reference)',
        },
        {
          identifier: {id: 'ms-vscode-remote.remote-containers'},
          version: '0.0.0',
          location: {$mid: 1, path: location, scheme: 'file'},
          relativeLocation: 'ms-vscode-remote.remote-containers-0.0.0',
          metadata: {source: 'vsix'},
        },
      ]);
    });

    it("containers-09: a stand-in's engines are those of the launch's own extension, and none for a launch without one or a manifest without them", () => {
      workspace.write(
        'packages/remote-explorer/package.json',
        JSON.stringify({}),
      );
      deepStrictEqual(
        [
          standInEngines(workspace.root, {
            label: 'a',
            kind: 'plain',
            suite: 'a',
            withExtensions: ['remote-oss.remote-containers'],
          }),
          standInEngines(workspace.root, {
            label: 'b',
            kind: 'plain',
            suite: 'b',
            withExtensions: ['remote-oss.remote-explorer'],
          }),
          standInEngines(workspace.root, {
            label: 'c',
            kind: 'plain',
            suite: 'c',
          }),
          standInEngines(workspace.root, {
            label: 'd',
            kind: 'plain',
            suite: 'd',
            withExtensions: ['remote-oss.unknown'],
          }),
          standInEngines(workspace.root, {
            label: 'e',
            runner: 'runner',
            suite: 'e',
          }),
        ],
        ['^1.139.0', '', '', '', ''],
      );
    });

    it("tooling-27: the download host's variables reach the launches", async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(
        harness.variables?.HARNESS_DOWNLOADS_HTTP,
        'http://downloads:8080',
      );
    });

    it('tooling-27: the download host is stopped when the run ends, also after a failure', async () => {
      harness.bundleSuiteError = new Error('bundle failed');
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(harness.calls.includes('downloads stopped'), true);
    });

    it("tooling-29: the VSCodium run gives the host the further keys and the authority, and starts the run's agent", async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      const containerRun =
        harness.calls.find(call => call.startsWith('docker run')) ?? '';
      deepStrictEqual(
        [
          containerRun.includes('AUTHORIZED_KEYS_FURTHER='),
          containerRun.includes('CA_PUBLIC_KEY='),
          harness.calls.some(
            call =>
              call.startsWith('agent started ') && call.endsWith('/agent.sock'),
          ),
        ],
        [true, true, true],
      );
    });

    it("tooling-29: the agent's socket and the passphrase file reach the launches", async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        [
          harness.variables?.SSH_AUTH_SOCK?.endsWith('/agent.sock'),
          harness.variables?.HARNESS_AGENT_SOCKET ===
            harness.variables?.SSH_AUTH_SOCK,
          harness.variables?.HARNESS_PASSPHRASE_FILE?.endsWith('/passphrase'),
        ],
        [true, true, true],
      );
    });

    it("tooling-29: the run's agent is stopped when the run ends, also after a failure", async () => {
      harness.bundleSuiteError = new Error('bundle failed');
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(harness.calls.includes('agent stopped'), true);
    });

    it('tooling-29: the VS Code run makes no further keys and starts no agent', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [
          harness.calls.some(call => call.startsWith('agent started')),
          harness.variables?.SSH_AUTH_SOCK,
        ],
        [false, undefined],
      );
    });

    it('tooling-27: the VS Code run starts no download host and gives the harness host no names', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        [
          harness.calls.includes('downloads started'),
          harness.calls.some(call => call.includes('--add-host')),
        ],
        [false, false],
      );
    });

    it('D-85: the window agent is packaged for the VSCodium run', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(harness.calls.includes('window agent vsix'), true);
    });

    it('D-85: the window agent is not packaged for the VS Code run', async () => {
      await runAcceptance(workspace.root, harness);
      strictEqual(harness.calls.includes('window agent vsix'), false);
    });

    it('D-85: the window agent is installed with the extensions under test', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      strictEqual(
        harness.calls.some(
          call =>
            call.includes('--install-extension') &&
            call.includes('window-agent.vsix'),
        ),
        true,
      );
    });

    it('D-85: the plain launch is not a test-cli configuration', () => {
      deepStrictEqual(
        configurations().filter(
          configuration => configuration.label === 'windows',
        ),
        [],
      );
    });

    it('#253 Q14: the VSIX files are installed with the command-line wrapper in the bin folder beside the executable', async () => {
      workspace.write('dist/remote-ssh-0.0.0.vsix', '');
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        [
          ...new Set(
            harness.calls
              .filter(call => call.includes('--install-extension'))
              .map(call => call.split(' ')[0]),
          ),
        ],
        [path.join('bin', 'codium-insiders')],
      );
    });

    it('#253 Q14, rulings 1 and 2: test-cli ran the local label, the remote one, the reconnection, each failing connect and the ports case, the ports case last', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(harness.launched, LAUNCH_ORDER);
    });

    it('coverage-13: a ports case answers from its own script, written before the first launch', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        JSON.parse(
          harness.firstLaunchFiles.get('ports-probe-script.json') ?? '',
        ),
        {
          entries: [
            {surface: 'failureDialog', match: '"', answer: 'dismiss'},
            {
              surface: 'mitigationPick',
              match: 'Pick an action',
              answer: 'dismiss',
            },
          ],
        },
      );
    });

    it("ruling 1: a failing connect's script is written before the first launch", async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        JSON.parse(
          harness.firstLaunchFiles.get('failure-refused-script.json') ?? '',
        ),
        {
          entries: FAILURE.script,
        },
      );
    });

    it('coverage-10: a labeled failing connect gets its script under its label', async () => {
      workspace.write(
        'tests/acceptance/suite-failure/cases.json',
        JSON.stringify({cases: [{...FAILURE, label: 'refused-shown'}]}),
      );
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        JSON.parse(
          harness.firstLaunchFiles.get('failure-refused-shown-script.json') ??
            '',
        ),
        {
          entries: FAILURE.script,
        },
      );
    });

    it('ruling 1: a failing connect opens a window on its alias', () => {
      deepStrictEqual(configurations()[6]?.launchArgs.slice(0, 2), [
        '--folder-uri',
        'vscode-remote://ssh-remote+refused/home/harness',
      ]);
    });

    it('ruling 1: a failing connect answers from its own script and record', () => {
      deepStrictEqual(
        [
          configurations()[6]?.env.REMOTE_OSS_ACCEPTANCE_SCRIPT,
          configurations()[6]?.env.REMOTE_OSS_ACCEPTANCE_RECORD,
        ],
        [
          path.join('/run', 'failure-refused-script.json'),
          path.join('/run', 'failure-refused-record.jsonl'),
        ],
      );
    });

    it("ruling 1: the other launches keep the run's script", () => {
      deepStrictEqual(
        configurations()
          .slice(0, 3)
          .map(configuration => configuration.env.REMOTE_OSS_ACCEPTANCE_SCRIPT),
        [undefined, undefined, undefined],
      );
    });

    it('ruling 1: the failing connects come from the cases file', () => {
      deepStrictEqual(failureCases(workspace.root), [FAILURE]);
    });

    it('triton on #439: an alias with a character outside its form is refused', () => {
      workspace.write(
        'tests/acceptance/suite-failure/cases.json',
        JSON.stringify({cases: [{...FAILURE, alias: '../x'}]}),
      );
      throws(() => failureCases(workspace.root), /alias must match/);
    });

    it('triton on #439: an alias that starts with a digit is refused', () => {
      workspace.write(
        'tests/acceptance/suite-failure/cases.json',
        JSON.stringify({cases: [{...FAILURE, alias: '9x'}]}),
      );
      throws(() => failureCases(workspace.root), /alias must match/);
    });

    it('coverage-11: the fake clients are written before the first client-search launch', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        harness.clientLaunches.map(launch => launch.fakes),
        [true],
      );
    });

    it('coverage-11: the tilde copy is written before the first client-search launch', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        harness.clientLaunches.map(launch => launch.tildeCopy),
        [true],
      );
    });

    it('coverage-11: a client-search launch finds the log of calls empty, whatever an earlier launch left', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        harness.clientLaunches.map(launch => launch.calls),
        [''],
      );
    });

    it('coverage-11: the run waits for the helper of the launch before to end: the grace before the slow launch and each host-case launch, 5 s before a client-search launch', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(harness.sleeps, [3000, 5000, 3000, 3000, 3000]);
    });

    it("coverage-11: a client-search launch finds its settings with the run's folder in place of the token", async () => {
      const cases = [{...CLIENT_CASE, setting: '<run>/clients/configured/ssh'}];
      workspace.write(
        'tests/acceptance/suite-client/cases.json',
        JSON.stringify({cases}),
      );
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        harness.clientLaunches.map(launch =>
          (JSON.parse(launch.settings) as Record<string, string>)[
            'remote.SSH.path'
          ]?.endsWith('/clients/configured/ssh'),
        ),
        [true],
      );
    });

    it('coverage-11: the VS Code run writes no fake clients', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(harness.clientLaunches, []);
    });

    it('#253 Q14: the harness variables name the editor and its executable', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        [
          harness.variables?.HARNESS_EDITOR,
          harness.variables?.HARNESS_VSCODIUM_EXECUTABLE,
        ],
        ['vscodium', 'codium-insiders'],
      );
    });

    it('#253 Q14: with the local run failing the exit code is non-zero', async () => {
      harness.labelResults.set('local', {exitCode: 3, output: ''});
      strictEqual(await runAcceptance(workspace.root, harness, 'vscodium'), 3);
    });

    it('#253 Q14: with the local run failing the remote ones still ran', async () => {
      harness.labelResults.set('local', {exitCode: 3, output: ''});
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(harness.launched, LAUNCH_ORDER);
    });

    it('#253 Q14: with the remote run failing the exit code is non-zero', async () => {
      harness.labelResults.set('remote', {exitCode: 4, output: ''});
      strictEqual(await runAcceptance(workspace.root, harness, 'vscodium'), 4);
    });

    it('#253 Q14: the remote configuration opens the folder on ssh-remote+harness', () => {
      deepStrictEqual(configurations()[1]?.launchArgs.slice(0, 2), [
        '--folder-uri',
        'vscode-remote://ssh-remote+harness/home/harness',
      ]);
    });

    it('#253 Q14: the local configuration opens no folder', () => {
      strictEqual(
        configurations()[0]?.launchArgs.includes('--folder-uri'),
        false,
      );
    });

    it('#253 Q14: every configuration uses the executable', () => {
      deepStrictEqual(
        configurations().map(
          configuration => configuration.useInstallation.fromPath,
        ),
        Array.from({length: 14}, () => EXECUTABLE),
      );
    });

    it('#253 Q14: every configuration enables the proposed API of remote-ssh', () => {
      deepStrictEqual(
        configurations().map(configuration =>
          configuration.launchArgs.includes(
            '--enable-proposed-api=remote-oss.remote-ssh',
          ),
        ),
        Array.from({length: 14}, () => true),
      );
    });

    it('#253 Q14: the configurations are labelled and read their own bundles', () => {
      deepStrictEqual(
        configurations().map(configuration => [
          configuration.label,
          configuration.files,
        ]),
        [
          ['local', 'dist-local/**/*.test.cjs'],
          ['remote', 'dist-remote/**/*.test.cjs'],
          ['reconnect', 'dist-reconnect/**/*.test.cjs'],
          ['agent', 'dist-forwarding/**/*.test.cjs'],
          ['agent-off', 'dist-forwarding/**/*.test.cjs'],
          ['x11', 'dist-forwarding/**/*.test.cjs'],
          ['failure-refused', 'dist-failure/**/*.test.cjs'],
          ['terminal', 'dist-terminal/**/*.test.cjs'],
          ['socket', 'dist-socket/**/*.test.cjs'],
          ['slow', 'dist-slow/**/*.test.cjs'],
          ['client-unset', 'dist-client/**/*.test.cjs'],
          ['ports-probe', 'dist-ports/**/*.test.cjs'],
          ['install-probe', 'dist-install/**/*.test.cjs'],
          ['platform-probe', 'dist-platform/**/*.test.cjs'],
        ],
      );
    });

    it('D-85: the terminal launch opens the folder on ssh-remote+harness', () => {
      deepStrictEqual(configurations()[7]?.launchArgs.slice(0, 2), [
        '--folder-uri',
        'vscode-remote://ssh-remote+harness/home/harness',
      ]);
    });

    it('D-85: a launch with an environment adds it to the extension host', () => {
      strictEqual(
        vscodiumConfiguration(
          workspace.root,
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
          {...LAUNCH, environment: {EXTRA: '1'}},
        ).env.EXTRA,
        '1',
      );
    });

    it("D-85: a launch's environment wins over the harness variable of the same name", () => {
      strictEqual(
        vscodiumConfiguration(
          workspace.root,
          {...CONFIGURATION_ENVIRONMENT, REMOTE_OSS_ACCEPTANCE_RECORD: 'run'},
          EXECUTABLE,
          {
            ...LAUNCH,
            ownScript: true,
            environment: {REMOTE_OSS_ACCEPTANCE_RECORD: 'launch'},
          },
        ).env.REMOTE_OSS_ACCEPTANCE_RECORD,
        'launch',
      );
    });

    it('D-85: a launch with further extensions loads them after the runner', () => {
      deepStrictEqual(
        vscodiumConfiguration(
          workspace.root,
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
          {...LAUNCH, extraExtensions: ['slow-remote']},
        ).extensionDevelopmentPath,
        [
          path.join(workspace.root, 'tests', 'acceptance', 'runner'),
          path.join(workspace.root, 'tests', 'acceptance', 'slow-remote'),
        ],
      );
    });

    it('F-3903 §5 rule 4: a runner launch with proposedApi false starts the editor without the proposed API', () => {
      deepStrictEqual(
        vscodiumConfiguration(
          workspace.root,
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
          {...LAUNCH, proposedApi: false},
        ).launchArgs.filter(argument =>
          argument.startsWith('--enable-proposed-api'),
        ),
        [],
      );
    });

    it('D-85: a launch with no environment adds its log file and its windows folder to the harness variables', () => {
      deepStrictEqual(
        vscodiumConfiguration(
          workspace.root,
          CONFIGURATION_ENVIRONMENT,
          EXECUTABLE,
          LAUNCH,
        ).env,
        {
          ...CONFIGURATION_ENVIRONMENT,
          REMOTE_OSS_ACCEPTANCE_LOG: path.join('/run', 'extra-log.txt'),
          REMOTE_OSS_ACCEPTANCE_WINDOWS: path.join(
            '/run',
            'extra',
            'agent',
            'pids',
          ),
        },
      );
    });

    it('D-85: the slow launch loads the slow extension from the host, by its remote address', () => {
      deepStrictEqual(
        configurations()[9]?.launchArgs.filter(argument =>
          argument.startsWith('--extensionDevelopmentPath='),
        ),
        [
          '--extensionDevelopmentPath=vscode-remote://ssh-remote+harness/home/harness/slow-remote',
        ],
      );
    });

    it('D-85: the run copies the slow extension into the host before the launches', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        harness.calls.filter(call => call.startsWith('docker cp ')),
        [
          `docker cp ${path.join(workspace.root, 'tests', 'acceptance', 'slow-remote')} ${CONTAINER}:/home/harness/slow-remote`,
        ],
      );
    });

    it('D-85: the copy of the slow extension belongs to the user harness', async () => {
      await runAcceptance(workspace.root, harness, 'vscodium');
      deepStrictEqual(
        harness.calls.filter(call => call.includes(' chown ')),
        [
          `docker exec --user root ${CONTAINER} chown -R harness:harness /home/harness/slow-remote`,
        ],
      );
    });

    it('D-85: the VS Code run copies no extension', async () => {
      await runAcceptance(workspace.root, harness);
      deepStrictEqual(
        harness.calls.filter(call => call.startsWith('docker cp ')),
        [],
      );
    });

    it('D-85: each launch writes the connection log to a file of its own', () => {
      deepStrictEqual(
        configurations().map(
          configuration => configuration.env.REMOTE_OSS_ACCEPTANCE_LOG,
        ),
        [
          'local',
          'remote',
          'reconnect',
          'agent',
          'agent-off',
          'x11',
          'failure-refused',
          'terminal',
          'socket',
          'slow',
          'client-unset',
          'ports-probe',
          'install-probe',
          'platform-probe',
        ].map(label => path.join('/run', `${label}-log.txt`)),
      );
    });

    it('D-85: each launch points its windows at the agent folder of its own label', () => {
      deepStrictEqual(
        configurations().map(
          configuration => configuration.env.REMOTE_OSS_ACCEPTANCE_WINDOWS,
        ),
        [
          'local',
          'remote',
          'reconnect',
          'agent',
          'agent-off',
          'x11',
          'failure-refused',
          'terminal',
          'socket',
          'slow',
          'client-unset',
          'ports-probe',
          'install-probe',
          'platform-probe',
        ].map(label => path.join('/run', label, 'agent', 'pids')),
      );
    });

    it('#253 Q14: every remote launch uses the workspace-kind runner', () => {
      deepStrictEqual(
        configurations()
          .slice(1)
          .map(
            configuration => [configuration.extensionDevelopmentPath].flat()[0],
          ),
        Array.from({length: 13}, () =>
          path.join(workspace.root, 'tests', 'acceptance', 'runner-remote'),
        ),
      );
    });

    it('#253 ruling 2: the reconnection opens the same folder as the remote launch', () => {
      deepStrictEqual(
        configurations()
          .slice(1, 3)
          .map(configuration => configuration.launchArgs.slice(0, 2)),
        [
          ['--folder-uri', 'vscode-remote://ssh-remote+harness/home/harness'],
          ['--folder-uri', 'vscode-remote://ssh-remote+harness/home/harness'],
        ],
      );
    });

    it('ADR-0007: the pinned release is at or above the engines floor', () => {
      const floor = /(\d+)\.(\d+)/.exec(
        (
          JSON.parse(
            readFileSync(
              path.join(
                REPOSITORY_ROOT,
                'packages',
                'remote-ssh',
                'package.json',
              ),
              'utf8',
            ),
          ) as {engines: {vscode: string}}
        ).engines.vscode,
      );
      const pinned = /^(\d+)\.(\d+)/.exec(
        VSCODIUM_RELEASE.tagName.split('-')[0] ?? '',
      );
      deepStrictEqual(
        Number(pinned?.[1]) * 1000 + Number(pinned?.[2]) >=
          Number(floor?.[1]) * 1000 + Number(floor?.[2]),
        true,
      );
    });

    it('#253 Q14: a download that does not match its checksum throws', async () => {
      await rejects(
        vscodiumExecutableOf(workspace.root, 'linux', 'x64', {
          download: () => Promise.resolve(new Uint8Array([1, 2, 3])),
          unpack: () => undefined,
        }),
        {message: 'the VSCodium download does not match its checksum'},
      );
    });

    /** The linux-x64 build fetched by a download whose checksum is pinned: the executable and the folders unpacked into. */
    async function fetchedForLinuxX64(): Promise<{
      executable: string;
      unpacked: string[];
    }> {
      const archive = new Uint8Array([1, 2, 3]);
      const unpacked: string[] = [];
      const executable = await vscodiumExecutableOf(
        workspace.root,
        'linux',
        'x64',
        {
          download: () => Promise.resolve(archive),
          unpack: (bytes, folder) => {
            unpacked.push(folder);
          },
        },
        {
          ...VSCODIUM_RELEASE.sha256,
          'linux-x64': createHash('sha256').update(archive).digest('hex'),
        },
      );
      return {executable, unpacked};
    }

    it('#253 Q14: a checked download is unpacked and the executable returned', async () => {
      const {executable, unpacked} = await fetchedForLinuxX64();
      deepStrictEqual(
        [executable, unpacked.length],
        [
          path.join(
            workspace.root,
            '.vscode-test',
            `vscodium-${VSCODIUM_RELEASE.tagName}-linux-x64`,
            'codium-insiders',
          ),
          1,
        ],
      );
    });

    it('#253 Q14: a build that is already there is not downloaded again', async () => {
      workspace.write(
        `.vscode-test/vscodium-${VSCODIUM_RELEASE.tagName}-linux-x64/codium-insiders`,
        '',
      );
      let downloads = 0;
      await vscodiumExecutableOf(workspace.root, 'linux', 'x64', {
        download: () => {
          downloads += 1;
          return Promise.resolve(new Uint8Array());
        },
        unpack: () => undefined,
      });
      strictEqual(downloads, 0);
    });

    it('#657: a build of another architecture is not taken for this one', async () => {
      workspace.write(
        `.vscode-test/vscodium-${VSCODIUM_RELEASE.tagName}-linux-arm64/codium-insiders`,
        '',
      );
      deepStrictEqual((await fetchedForLinuxX64()).unpacked, [
        path.join(
          workspace.root,
          '.vscode-test',
          `vscodium-${VSCODIUM_RELEASE.tagName}-linux-x64`,
        ),
      ]);
    });

    it('#253 Q14: a platform with no pinned build throws', async () => {
      await rejects(
        vscodiumExecutableOf(workspace.root, 'darwin', 'arm64', {
          download: () => Promise.resolve(new Uint8Array()),
          unpack: () => undefined,
        }),
        {message: 'no VSCodium build is pinned for darwin-arm64'},
      );
    });

    it('#253 Q14: a download that answers with an error status throws after its one retry', async () => {
      await rejects(
        downloadWithRetry(
          'https://example.invalid/a',
          () => Promise.resolve(new Response('', {status: 404})),
          () => Promise.resolve(),
        ),
        {message: 'https://example.invalid/a: 404'},
      );
    });

    it('#253 Q14: a download returns the bytes the server sent', async () => {
      deepStrictEqual(
        await downloadWithRetry(
          'https://example.invalid/a',
          () => Promise.resolve(new Response(new Uint8Array([7, 8]))),
          () => Promise.resolve(),
        ),
        new Uint8Array([7, 8]),
      );
    });

    it('#253 Q14: an archive is unpacked into the folder and its own file removed', () => {
      workspace.write('source/codium-insiders', 'binary');
      const archive = path.join(workspace.root, 'source.tar.gz');
      runCommand('tar', [
        '-czf',
        archive,
        '-C',
        path.join(workspace.root, 'source'),
        '.',
      ]);
      unpackArchive(
        readFileSync(archive),
        path.join(workspace.root, 'unpacked'),
      );
      deepStrictEqual(
        [
          readFileSync(
            path.join(workspace.root, 'unpacked', 'codium-insiders'),
            'utf8',
          ),
          existsSync(path.join(workspace.root, 'unpacked', 'archive.tar.gz')),
        ],
        ['binary', false],
      );
    });

    it('#253 Q14: --editor vs is not understood', () => {
      strictEqual(editorChoiceOf(['--editor', 'vs']), undefined);
    });

    it('#253 Q14: --editor vscodium picks VSCodium', () => {
      strictEqual(editorChoiceOf(['--editor', 'vscodium']), 'vscodium');
    });

    it('#253 Q14: no arguments pick VS Code', () => {
      strictEqual(editorChoiceOf([]), 'vscode');
    });

    it('#253 Q14: an extra argument is not understood', () => {
      strictEqual(editorChoiceOf(['--editor', 'vscode', 'more']), undefined);
    });

    it('tooling-50: --launches takes a comma list, none or all, with VSCodium only', () => {
      deepStrictEqual(
        [
          runArgumentsOf(['--editor', 'vscodium', '--launches', 'a,b']),
          runArgumentsOf(['--editor', 'vscodium', '--launches', 'none']),
          runArgumentsOf(['--launches', 'all', '--editor', 'vscodium']),
          runArgumentsOf(['--editor', 'vscode', '--launches', 'a']),
          runArgumentsOf(['--editor', 'vscodium', '--launches']),
          runArgumentsOf(['--editor', 'vscodium']),
        ],
        [
          {editor: 'vscodium', launches: ['a', 'b']},
          {editor: 'vscodium', launches: []},
          {editor: 'vscodium'},
          undefined,
          undefined,
          {editor: 'vscodium'},
        ],
      );
    });

    it('tooling-51: no selection leaves the launches that are named only out, a selection that names one keeps it, in table order', () => {
      const launches = launchesOf(REPOSITORY_ROOT);
      function labels(selected: string[] | undefined): string[] {
        return chosenLabels(launches, selected);
      }
      deepStrictEqual(
        [
          labels(undefined).includes('genuine'),
          labels(['genuine']),
          labels(['genuine', 'remote']),
        ],
        [false, ['genuine'], ['remote', 'genuine']],
      );
    });

    it('tooling-51, connect-84: the genuine-client launches are the last of the table', () => {
      deepStrictEqual(
        launchesOf(REPOSITORY_ROOT)
          .slice(-2)
          .map(launch => launch.label),
        ['genuine', 'ssh-no-proposals'],
      );
    });

    it('tooling-51: the executable of a launch is VS Code’s for a launch of that client and VSCodium’s for any other', () => {
      const variables: Partial<HarnessVariables> = {
        HARNESS_VSCODE_EXECUTABLE: '/vscode/code',
        HARNESS_VSCODIUM_EXECUTABLE: '/vscodium/codium',
      };
      const launches = launchesOf(REPOSITORY_ROOT);
      deepStrictEqual(
        ['genuine', 'windows', 'local'].map(label =>
          editorExecutableOf(
            variables as HarnessVariables,
            launchLabelled(launches, label),
          ),
        ),
        ['/vscode/code', '/vscodium/codium', '/vscodium/codium'],
      );
    });

    it('tooling-50: an unknown label names the known ones', () => {
      strictEqual(
        chosenLaunches(
          [
            {label: 'local', runner: 'runner', suite: 'suite-local'},
            {label: 'remote', runner: 'runner-remote', suite: 'suite-remote'},
          ],
          ['remote', 'nope'],
        ),
        'unknown launch label(s): nope; the known ones: local, remote; the groups: @ssh, @hosts, @explorer, @containers, @genuine',
      );
    });

    it('tooling-53: a group names its launches in table order, ! takes out what came before, and all,!genuine is all', () => {
      const launches = launchesOf(REPOSITORY_ROOT);
      function labels(selected: string[] | undefined): string[] {
        return chosenLabels(launches, selected);
      }
      function ofGroup(group: string): string[] {
        return launches
          .filter(launch => launchGroupOf(launch) === group)
          .map(launch => launch.label);
      }
      deepStrictEqual(
        [
          labels(['@containers']),
          labels(['all', '!genuine']),
          labels(['@ssh', '!terminal']).includes('terminal'),
          labels(['@ssh', '!terminal']).length,
          labels(['@hosts', '@explorer']),
          labels(['!remote']),
          labels(['@genuine']),
          labels(['@containers', '!@containers', 'containers']),
        ],
        [
          ofGroup('containers'),
          labels(undefined),
          false,
          ofGroup('ssh').length - 1,
          launches
            .filter(launch =>
              ['explorer', 'hosts'].includes(launchGroupOf(launch)),
            )
            .map(launch => launch.label),
          [],
          ['genuine', 'ssh-no-proposals'],
          ['containers'],
        ],
      );
    });

    it('tooling-53: an unknown group fails like an unknown label, listing the groups', () => {
      deepStrictEqual(
        [
          chosenLaunches(
            [{label: 'local', runner: 'runner', suite: 'suite-local'}],
            ['@nope', '!@nada'],
          ),
          runArgumentsOf([
            '--editor',
            'vscodium',
            '--launches',
            'all,!genuine',
          ]),
        ],
        [
          'unknown launch label(s): @nope, !@nada; the known ones: local; the groups: @ssh, @hosts, @explorer, @containers, @genuine',
          {editor: 'vscodium', launches: ['all', '!genuine']},
        ],
      );
    });

    it('tooling-53: the selection line names the groups of the launches it makes', () => {
      const launches = launchesOf(REPOSITORY_ROOT);
      const chosen = chosenLaunches(launches, ['explorer', 'genuine']);
      deepStrictEqual(
        [
          typeof chosen === 'string'
            ? chosen
            : selectionLine(launches, chosen).split(':')[0],
          selectionLine(launches, []).startsWith('no launch reachable'),
        ],
        ['launches made (2, groups @explorer, @genuine)', true],
      );
    });

    it('#253 Q14: the tool exits 2 with the usage line for an unknown editor', () => {
      const result = runCommand(process.execPath, [
        path.join(REPOSITORY_ROOT, 'tools', 'acceptance.ts'),
        '--editor',
        'vs',
      ]);
      deepStrictEqual([result.status, result.stderr.trim()], [2, USAGE]);
    });
  });

  describe('bundleSuite', () => {
    beforeEach(() => {
      workspace.write(
        'tests/acceptance/suite/host.test.ts',
        "import {helper} from './helper.ts';\nhelper();\n",
      );
      workspace.write(
        'tests/acceptance/suite/helper.ts',
        'export function helper(): void {}\n',
      );
      workspace.write(
        'tests/acceptance/suite/settle.ts',
        readFileSync(
          path.join(REPOSITORY_ROOT, 'tests/acceptance/suite/settle.ts'),
          'utf8',
        ),
      );
      workspace.write('tests/acceptance/suite-local/window.test.ts', '');
      workspace.write('tests/acceptance/suite-remote/window.test.ts', '');
      workspace.write('tests/acceptance/suite-reconnect/window.test.ts', '');
      workspace.write('tests/acceptance/suite-forwarding/window.test.ts', '');
      workspace.write('tests/acceptance/suite-failure/window.test.ts', '');
      workspace.write('tests/acceptance/suite-terminal/window.test.ts', '');
      workspace.write('tests/acceptance/suite-socket/window.test.ts', '');
      workspace.write('tests/acceptance/suite-slow/window.test.ts', '');
      workspace.write('tests/acceptance/suite-ports/window.test.ts', '');
      workspace.write('tests/acceptance/suite-platform/window.test.ts', '');
      workspace.write(
        'tests/acceptance/slow-remote/src/extension.ts',
        'export function activate(): void {}\n',
      );
    });

    it('bundles each suite test file into one CommonJS file', async () => {
      await bundleSuite(workspace.root);
      deepStrictEqual(
        [
          existsSync(
            path.join(workspace.root, 'tests/acceptance/dist/host.test.cjs'),
          ),
          existsSync(
            path.join(workspace.root, 'tests/acceptance/dist/helper.cjs'),
          ),
        ],
        [true, false],
      );
    });

    it('tooling-32: each output folder holds the settle bundle beside the suites own', async () => {
      await bundleSuite(workspace.root);
      deepStrictEqual(
        ['dist', 'dist-local', 'dist-remote'].map(folder =>
          existsSync(
            path.join(
              workspace.root,
              'tests/acceptance',
              folder,
              'settle.test.cjs',
            ),
          ),
        ),
        [true, true, true],
      );
    });

    it('tooling-32: the settle bundle holds a plain mocha run open for 2000 ms after its last test, and the run passes', async () => {
      await bundleSuite(workspace.root);
      const folder = path.join(workspace.root, 'tests/acceptance/dist-local');
      const stamp = path.join(workspace.root, 'last-row.txt');
      writeFileSync(
        path.join(folder, 'row.test.cjs'),
        `it('row', () => { require('node:fs').writeFileSync(${JSON.stringify(stamp)}, String(Date.now())); });\n`,
      );
      const result = runCommand(process.execPath, [
        path.join(REPOSITORY_ROOT, 'node_modules/mocha/bin/mocha.js'),
        '--no-config',
        '--timeout',
        '10000',
        path.join(folder, 'row.test.cjs'),
        path.join(folder, 'settle.test.cjs'),
      ]);
      deepStrictEqual(
        [
          result.status,
          Date.now() - Number(readFileSync(stamp, 'utf8')) >= 2000,
        ],
        [0, true],
      );
    });

    it('tooling-32: the suite-client source defines no hold of its own', () => {
      strictEqual(
        readFileSync(
          path.join(
            REPOSITORY_ROOT,
            'tests/acceptance/suite-client/client.test.ts',
          ),
          'utf8',
        ).includes('SETTLE_MILLISECONDS'),
        false,
      );
    });

    it('#439: a bundle a former run left in an output folder is gone after bundling', async () => {
      workspace.write('tests/acceptance/dist-failure/stale.test.cjs', '');
      await bundleSuite(workspace.root);
      strictEqual(
        existsSync(
          path.join(
            workspace.root,
            'tests/acceptance/dist-failure/stale.test.cjs',
          ),
        ),
        false,
      );
    });

    it('#439: removeBundles leaves no output folder', async () => {
      await bundleSuite(workspace.root);
      removeBundles(workspace.root);
      deepStrictEqual(
        [
          'dist',
          'dist-local',
          'dist-remote',
          'dist-reconnect',
          'dist-failure',
          'dist-terminal',
          'dist-socket',
          'dist-slow',
          'dist-ports',
          'dist-platform',
        ].map(folder =>
          existsSync(path.join(workspace.root, 'tests/acceptance', folder)),
        ),
        [false, false, false, false, false, false, false, false, false, false],
      );
    });

    it('D-85: bundles the slow extension into the extension.cjs beside its package.json', async () => {
      await bundleSuite(workspace.root);
      strictEqual(
        existsSync(
          path.join(
            workspace.root,
            'tests/acceptance/slow-remote/extension.cjs',
          ),
        ),
        true,
      );
    });

    it('D-85: removeBundles removes the extension bundle too', async () => {
      await bundleSuite(workspace.root);
      removeBundles(workspace.root);
      strictEqual(
        existsSync(
          path.join(
            workspace.root,
            'tests/acceptance/slow-remote/extension.cjs',
          ),
        ),
        false,
      );
    });

    it('bundles the suite of each launch into its own folder', async () => {
      await bundleSuite(workspace.root);
      deepStrictEqual(
        [
          'dist-local',
          'dist-remote',
          'dist-reconnect',
          'dist-failure',
          'dist-terminal',
          'dist-socket',
          'dist-slow',
          'dist-ports',
          'dist-platform',
        ].map(folder =>
          existsSync(
            path.join(
              workspace.root,
              'tests/acceptance',
              folder,
              'window.test.cjs',
            ),
          ),
        ),
        [true, true, true, true, true, true, true, true, true],
      );
    });
  });

  it('collects the exit status and output of a command', () => {
    deepStrictEqual(
      runCommand(process.execPath, [
        '-e',
        'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 4',
      ]),
      {status: 4, stdout: 'out', stderr: 'err'},
    );
  });

  it("returns test-cli's failure when it cannot load the configuration", async () => {
    notStrictEqual(
      (
        await runTestCli(workspace.root, {
          REMOTE_OSS_ACCEPTANCE: '1',
          HARNESS_SSH_CONFIG: '',
          HARNESS_CONTAINER: '',
          HARNESS_ROUTED_ADDRESS: '',
          HARNESS_RUN_FOLDER: '',
          HARNESS_RUN_ID: '',
          HARNESS_PASSWORD_FILE: '',
          REMOTE_OSS_ACCEPTANCE_SCRIPT: '',
          REMOTE_OSS_ACCEPTANCE_RECORD: '',
          REMOTE_OSS_ACCEPTANCE_SIGNALS: '',
          HARNESS_VSIX_FILES: '',
          HARNESS_EDITOR: 'vscode',
          REMOTE_OSS_ACCEPTANCE_LOG: '',
        })
      ).exitCode,
      0,
    );
  });
});

describe('the harness of the windows suites, bundled for the editor', () => {
  it("coverage-19: the harness bundle loads with an argv[1] set and no import.meta.url, as in the editor's extension host", async () => {
    const {build} = await import('esbuild');
    const folder = mkdtempSync(path.join(tmpdir(), 'harness-bundle-'));
    try {
      const bundle = path.join(folder, 'harness.cjs');
      await build({
        entryPoints: [
          path.join(REPOSITORY_ROOT, 'tests/acceptance/windows/harness.ts'),
        ],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['vscode'],
        logLevel: 'silent',
      });
      const loaded = spawnSync(process.execPath, [bundle], {encoding: 'utf8'});
      deepStrictEqual([loaded.status, loaded.stderr], [0, '']);
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
