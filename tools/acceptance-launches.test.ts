import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {
  bundleFolderOf,
  clientCases,
  CONFIG_FILE_LAUNCHES,
  extensionsOf,
  failureCases,
  LABEL_FORM,
  launchesOf,
  HOST_CASE_SUITES,
  type HostCase,
  hostCases,
  hostSetupOf,
  runnerLaunches,
  suitesOf,
  withHarnessBases,
  withRunTokens,
} from './acceptance-launches.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const [PORTS_SUITE, INSTALL_SUITE] = HOST_CASE_SUITES as [
  (typeof HOST_CASE_SUITES)[number],
  (typeof HOST_CASE_SUITES)[number],
];

/** The labels of the host-case launches, in the order of the suites and their cases. */
function hostLaunchLabels(): string[] {
  return HOST_CASE_SUITES.flatMap(suite =>
    hostCases(REPOSITORY_ROOT, suite.suite).map(
      hostCase => `${suite.prefix}-${hostCase.label}`,
    ),
  );
}

describe('the launches of the VSCodium run', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  it('D-85: the labels are local, remote, reconnect, agent, agent-off, x11, the failing connects in the order of the cases file, then terminal, socket, slow, the client searches, terminal-pick, windows, default-ports, no-proposals, the three explorer launches, the two trust launches and the ports cases in the order of theirs', () => {
    deepStrictEqual(
      launches.map(launch => launch.label),
      [
        'local',
        'remote',
        'reconnect',
        'agent',
        'agent-off',
        'x11',
        ...failureCases(REPOSITORY_ROOT).map(
          failure => `failure-${failure.label ?? failure.alias}`,
        ),
        'terminal',
        'socket',
        'slow',
        ...clientCases(REPOSITORY_ROOT).map(each => each.label),
        'terminal-pick',
        'windows',
        'config-files',
        'default-ports',
        'no-proposals',
        'explorer',
        'explorer-alone',
        'explorer-no-proposals',
        'trust',
        'trust-terminal',
        ...hostLaunchLabels(),
      ],
    );
  });

  it('coverage-20: the config-files launch runs with its own HOME, the recorder first on the PATH and no agent socket', () => {
    deepStrictEqual(
      launches.find(launch => launch.label === 'config-files')?.environment,
      {
        HOME: '<run>/home',
        PATH: '<run>/ssh-bin:<path>',
        SSH_AUTH_SOCK: '',
        XDG_CACHE_HOME: '<run>/xdg/cache',
        XDG_CONFIG_HOME: '<run>/xdg/config',
        XDG_DATA_HOME: '<run>/xdg/data',
        XDG_STATE_HOME: '<run>/xdg/state',
      },
    );
  });

  it('connect-39: the forwarding launches) open their aliases with the case named, and agent-off turns agent forwarding off', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.suite === 'suite-forwarding')
        .map(launch => [
          launch.label,
          launch.folderUri,
          launch.environment,
          launch.settings,
        ]),
      [
        [
          'agent',
          'vscode-remote://ssh-remote+agentfwd/home/harness',
          {HARNESS_FORWARDING_CASE: 'agent'},
          undefined,
        ],
        [
          'agent-off',
          'vscode-remote://ssh-remote+agentfwd-off/home/harness',
          {HARNESS_FORWARDING_CASE: 'agent-off'},
          {'remote.SSH.enableAgentForwarding': false},
        ],
        [
          'x11',
          'vscode-remote://ssh-remote+x11fwd/home/harness',
          {HARNESS_FORWARDING_CASE: 'x11'},
          undefined,
        ],
      ],
    );
  });

  it('tooling-30, tooling-33: only the explorer launches install the explorer, they and the trust launches open a debugging port, and only explorer-alone disables remote-ssh', () => {
    deepStrictEqual(
      launches.flatMap(launch =>
        launch.kind === 'plain' &&
        (launch.withExtensions !== undefined ||
          launch.debuggingPort !== undefined ||
          launch.disabledExtensions !== undefined)
          ? [
              [
                launch.label,
                launch.withExtensions,
                launch.debuggingPort,
                launch.disabledExtensions,
              ],
            ]
          : [],
      ),
      [
        ['explorer', ['remote-oss.remote-explorer'], true, undefined],
        [
          'explorer-alone',
          ['remote-oss.remote-explorer'],
          true,
          ['remote-oss.remote-ssh'],
        ],
        [
          'explorer-no-proposals',
          ['remote-oss.remote-explorer'],
          true,
          undefined,
        ],
        ['trust', undefined, true, undefined],
        ['trust-terminal', undefined, true, undefined],
      ],
    );
  });

  it('tooling-33: the two trust launches are the only ones with workspace trust on; trust turns core’s startup prompt on, and trust-terminal keeps core’s defaults with the terminal mode', () => {
    deepStrictEqual(
      launches.flatMap(launch =>
        launch.kind === 'plain' && launch.workspaceTrust !== undefined
          ? [[launch.label, launch.workspaceTrust, launch.settings]]
          : [],
      ),
      [
        [
          'trust',
          true,
          {
            'window.title': '[${rootName}]',
            'security.workspace.trust.startupPrompt': 'once',
          },
        ],
        [
          'trust-terminal',
          true,
          {
            'window.title': '[${rootName}]',
            'remote.SSH.useLocalServer': false,
            'remote.SSH.remotePlatform': {harness: 'linux'},
          },
        ],
      ],
    );
  });

  it('D-85: every label has the form of an alias', () => {
    deepStrictEqual(
      launches.filter(launch => !LABEL_FORM.test(launch.label)),
      [],
    );
  });

  it('D-85: the terminal launch turns the local server off and names the platform of the host, so that no pick is asked', () => {
    deepStrictEqual(
      launches.find(launch => launch.label === 'terminal')?.settings,
      {
        'remote.SSH.useLocalServer': false,
        'remote.SSH.remotePlatform': {harness: 'linux'},
      },
    );
  });

  it('F-2410 AC-2: the socket launch turns the listen-on-socket setting on and names the platform of the host', () => {
    deepStrictEqual(
      launches.find(launch => launch.label === 'socket')?.settings,
      {
        'remote.SSH.remoteServerListenOnSocket': true,
        'remote.SSH.remotePlatform': {harness: 'linux'},
      },
    );
  });

  it('D-85: no launch outside the list sets remote.SSH.configFile', () => {
    deepStrictEqual(
      launches
        .filter(
          launch =>
            launch.settings?.['remote.SSH.configFile'] !== undefined &&
            !CONFIG_FILE_LAUNCHES.includes(launch.label),
        )
        .map(launch => launch.label),
      [],
    );
  });

  it('D-85: the settings of their own are agent-off, the terminal and socket launches, the failing connects that name them, the client searches, default-ports, the explorer and trust launches and every ports case', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.settings !== undefined)
        .map(launch => launch.label),
      [
        'agent-off',
        'failure-refused-shown',
        'failure-platform-escape',
        'failure-port-range-busy',
        'failure-i686',
        'terminal',
        'socket',
        ...clientCases(REPOSITORY_ROOT).map(each => each.label),
        'terminal-pick',
        'default-ports',
        'explorer',
        'explorer-alone',
        'explorer-no-proposals',
        'trust',
        'trust-terminal',
        ...hostLaunchLabels(),
      ],
    );
  });

  it('tooling-30: an explorer launch titles each window with its folder name in brackets', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.label.startsWith('explorer'))
        .map(launch => launch.settings),
      Array.from({length: 3}, () => ({'window.title': '[${rootName}]'})),
    );
  });

  it('coverage-10: a failing connect with a label launches on failure-<label>, so one alias runs twice', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.suite === 'suite-failure')
        .map(launch => launch.label),
      [
        'failure-refused',
        'failure-nowhere',
        'failure-stranger',
        'failure-refused-shown',
        'failure-stranger-cancel',
        'failure-readonly',
        'failure-platform-escape',
        'failure-port-range-busy',
        'failure-i686',
      ],
    );
  });

  it('coverage-10: each failing connect names its case for the window, by its label or its alias', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.suite === 'suite-failure')
        .map(launch => [
          launch.label,
          launch.environment?.HARNESS_FAILURE_CASE,
        ]),
      [
        ['failure-refused', 'refused'],
        ['failure-nowhere', 'nowhere'],
        ['failure-stranger', 'stranger'],
        ['failure-refused-shown', 'refused-shown'],
        ['failure-stranger-cancel', 'stranger-cancel'],
        ['failure-readonly', 'readonly'],
        ['failure-platform-escape', 'platform-escape'],
        ['failure-port-range-busy', 'port-range-busy'],
        ['failure-i686', 'i686'],
      ],
    );
  });

  it('#680: the client listeners of a failing connect reach its launch, and a case without them has none', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.suite === 'suite-failure')
        .map(launch => [launch.label, launch.clientListeners]),
      [
        ['failure-refused', undefined],
        ['failure-nowhere', undefined],
        ['failure-stranger', undefined],
        ['failure-refused-shown', undefined],
        ['failure-stranger-cancel', undefined],
        ['failure-readonly', undefined],
        ['failure-platform-escape', undefined],
        ['failure-port-range-busy', [41060, 41061]],
        ['failure-i686', undefined],
      ],
    );
  });

  it('coverage-10: the settings of a failing connect reach its launch', () => {
    deepStrictEqual(
      [
        launches.find(launch => launch.label === 'failure-refused-shown')
          ?.settings,
        launches.find(launch => launch.label === 'failure-platform-escape')
          ?.settings,
        launches.find(launch => launch.label === 'failure-stranger-cancel')
          ?.settings,
      ],
      [
        {'remote.SSH.showLoginTerminal': true},
        {'remote.SSH.useLocalServer': false},
        undefined,
      ],
    );
  });

  it('coverage-10: a label outside its form is refused', () => {
    const workspace = new TemporaryWorkspace('launches');
    try {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [{alias: 'a', cite: 'c', script: [], dialog: 'd', label: 'A-b'}],
      });
      throws(() => failureCases(workspace.root), /label must match/);
    } finally {
      workspace.remove();
    }
  });

  it("coverage-10: a label the same as another connect's alias is refused", () => {
    const workspace = new TemporaryWorkspace('launches');
    try {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [
          {alias: 'refused', cite: 'c', script: [], dialog: 'd'},
          {
            label: 'refused',
            alias: 'stranger',
            cite: 'c',
            script: [],
            dialog: 'd',
          },
        ],
      });
      throws(
        () => failureCases(workspace.root),
        /two failing connects share the label "refused"/,
      );
    } finally {
      workspace.remove();
    }
  });

  it('coverage-10: two connects with the same label are refused', () => {
    const workspace = new TemporaryWorkspace('launches');
    try {
      workspace.write('tests/acceptance/suite-failure/cases.json', {
        cases: [
          {label: 'x', alias: 'a', cite: 'c', script: [], dialog: 'd'},
          {label: 'x', alias: 'b', cite: 'c', script: [], dialog: 'd'},
        ],
      });
      throws(
        () => failureCases(workspace.root),
        /two failing connects share the label "x"/,
      );
    } finally {
      workspace.remove();
    }
  });
});

describe('the ports cases', () => {
  const launches = launchesOf(REPOSITORY_ROOT);
  const cases = hostCases(REPOSITORY_ROOT, 'suite-ports');

  /** The case of the suite by its label; an error when the cases file lacks it. */
  function caseOf(label: string): HostCase {
    const current = cases.find(candidate => candidate.label === label);
    if (current === undefined) {
      throw new Error(`no ports case named ${label}`);
    }
    return current;
  }

  it('coverage-13: a ports launch opens its case on the default authority', () => {
    const current = caseOf('range');
    deepStrictEqual(
      launches.filter(launch => launch.label === 'ports-range'),
      [
        {
          label: 'ports-range',
          runner: 'runner-remote',
          suite: 'suite-ports',
          folderUri: 'vscode-remote://ssh-remote+harness/home/harness',
          settings: current.settings,
          environment: {HARNESS_PORTS_CASE: 'range'},
          ownScript: true,
          hostSetup: hostSetupOf(current, PORTS_SUITE),
        },
      ],
    );
  });

  it('coverage-13: a ports launch named by an authority opens it', () => {
    strictEqual(
      launches.find(launch => launch.label === 'ports-address')?.folderUri,
      'vscode-remote://ssh-remote+harness@127.0.0.1/home/harness',
    );
  });

  it('coverage-13: the setup frees the held ports and the server, then holds each port and waits for it', () => {
    const current = caseOf('range-gaps');
    deepStrictEqual(hostSetupOf(current, PORTS_SUITE), [
      {command: "pkill -f 'n[c] -lk -p'; true"},
      {
        command:
          "pkill -f '/home/harness/[.]vscodium-server-insiders/bin/'; " +
          'for i in $(seq 1 20); do ' +
          "pgrep -f '/home/harness/[.]vscodium-server-insiders/bin/' >/dev/null || exit 0; " +
          'sleep 0.5; done; exit 1',
      },
      {command: 'nc -lk -p 45000 -s 127.0.0.1 -e /bin/true', detach: true},
      {command: 'nc -lk -p 45002 -s 127.0.0.1 -e /bin/true', detach: true},
      {
        command:
          'for i in $(seq 1 20); do ' +
          "netstat -ltn | grep -q ' 127.0.0.1:45000 ' && exit 0; " +
          'sleep 0.25; done; exit 1',
      },
      {
        command:
          'for i in $(seq 1 20); do ' +
          "netstat -ltn | grep -q ' 127.0.0.1:45002 ' && exit 0; " +
          'sleep 0.25; done; exit 1',
      },
    ]);
  });

  it('coverage-13: a case that keeps the server gets no kill of it', () => {
    const current = caseOf('reuse');
    deepStrictEqual(hostSetupOf(current, PORTS_SUITE), [
      {command: "pkill -f 'n[c] -lk -p'; true"},
    ]);
  });

  it('coverage-13: a case with no holders frees only the server', () => {
    deepStrictEqual(hostSetupOf(caseOf('range'), PORTS_SUITE).length, 2);
  });

  it('coverage-13: a label outside its form is refused', () => {
    const workspace = new TemporaryWorkspace('ports');
    try {
      workspace.write('tests/acceptance/suite-ports/cases.json', {
        cases: [{label: 'A-b', cite: 'c', settings: {}, outcome: 'connected'}],
      });
      throws(
        () => hostCases(workspace.root, 'suite-ports'),
        /label must match/,
      );
    } finally {
      workspace.remove();
    }
  });

  it('coverage-13: two cases with the same label are refused', () => {
    const workspace = new TemporaryWorkspace('ports');
    try {
      workspace.write('tests/acceptance/suite-ports/cases.json', {
        cases: [
          {label: 'x', cite: 'c', settings: {}, outcome: 'connected'},
          {label: 'x', cite: 'c', settings: {}, outcome: 'connected'},
        ],
      });
      throws(
        () => hostCases(workspace.root, 'suite-ports'),
        /share the label "x"/,
      );
    } finally {
      workspace.remove();
    }
  });
});

describe('the install cases (card coverage-17)', () => {
  const STOP_SERVER =
    "pkill -f '/home/harness/[.]vscodium-server-insiders/bin/'; " +
    'for i in $(seq 1 20); do ' +
    "pgrep -f '/home/harness/[.]vscodium-server-insiders/bin/' >/dev/null || exit 0; " +
    'sleep 0.5; done; exit 1';
  const REMOVE = 'rm -rf /home/harness/.vscodium-server-insiders /tmp/srv';

  /** An install case of `fields`, with the label and cite every case has. */
  function installCase(fields: Partial<HostCase>): HostCase {
    return {label: 'x', cite: 'c', settings: {}, ...fields};
  }

  it('coverage-17: a case that keeps nothing stops the server and removes the data folder', () => {
    deepStrictEqual(hostSetupOf(installCase({}), INSTALL_SUITE), [
      {command: "pkill -f 'n[c] -lk -p'; true"},
      {command: STOP_SERVER},
      {command: REMOVE},
    ]);
  });

  it('coverage-17: a case that keeps the files stops the server and removes nothing', () => {
    deepStrictEqual(
      hostSetupOf(installCase({keepFiles: true}), INSTALL_SUITE),
      [{command: "pkill -f 'n[c] -lk -p'; true"}, {command: STOP_SERVER}],
    );
  });

  it('coverage-17: a case that keeps the server neither stops nor removes it', () => {
    deepStrictEqual(
      hostSetupOf(installCase({keepServer: true}), INSTALL_SUITE),
      [{command: "pkill -f 'n[c] -lk -p'; true"}],
    );
  });

  it("coverage-17: a case's own commands run last, in order", () => {
    deepStrictEqual(
      hostSetupOf(
        installCase({keepServer: true, setup: ['true a', 'true b']}),
        INSTALL_SUITE,
      ),
      [
        {command: "pkill -f 'n[c] -lk -p'; true"},
        {command: 'true a'},
        {command: 'true b'},
      ],
    );
  });

  it('coverage-17: each install case is a launch of its own, named install-<label>, with its variable', () => {
    const install = launchesOf(REPOSITORY_ROOT).filter(launch =>
      launch.label.startsWith('install-'),
    );
    deepStrictEqual(
      install.map(launch => [
        launch.label,
        launch.suite,
        launch.kind === 'plain' ? undefined : launch.environment,
      ]),
      hostCases(REPOSITORY_ROOT, 'suite-install').map(hostCase => [
        `install-${hostCase.label}`,
        'suite-install',
        {HARNESS_INSTALL_CASE: hostCase.label},
      ]),
    );
  });

  it("coverage-17: the download host's bases are put into a launch's settings, at any depth, and nothing else", () => {
    deepStrictEqual(
      withHarnessBases(
        {
          template: '${HARNESS_DOWNLOADS_HTTP}/ok/${os}-${arch}/${commit}',
          nested: [{local: '${HARNESS_DOWNLOADS_LOCAL}/x'}],
          other: '${HARNESS_RUN_FOLDER}',
          count: 3,
        },
        {
          HARNESS_DOWNLOADS_HTTP: 'http://downloads:9',
          HARNESS_DOWNLOADS_LOCAL: 'http://127.0.0.1:9',
        },
      ),
      {
        template: 'http://downloads:9/ok/${os}-${arch}/${commit}',
        nested: [{local: 'http://127.0.0.1:9/x'}],
        other: '${HARNESS_RUN_FOLDER}',
        count: 3,
      },
    );
  });

  it('coverage-17: a base the run has not got is left as written', () => {
    deepStrictEqual(
      withHarnessBases('${HARNESS_DOWNLOADS_HTTPS}/ok', {}),
      '${HARNESS_DOWNLOADS_HTTPS}/ok',
    );
  });
});

describe('the client-search launches', () => {
  const searches = launchesOf(REPOSITORY_ROOT).filter(launch =>
    launch.label.startsWith('client-'),
  );

  it('coverage-11: there are 18, one for each case of the cases file', () => {
    deepStrictEqual(
      [searches.length, clientCases(REPOSITORY_ROOT).length],
      [18, 18],
    );
  });

  it('coverage-11: each runs suite-client in a remote window with a script and record of its own', () => {
    deepStrictEqual(
      searches.map(launch => [
        launch.kind,
        launch.suite,
        launch.folderUri,
        'ownScript' in launch ? launch.ownScript : undefined,
      ]),
      searches.map(() => [
        undefined,
        'suite-client',
        'vscode-remote://ssh-remote+harness/home/harness',
        true,
      ]),
    );
  });

  it("coverage-11: each puts the run's fake clients first on the PATH and names its case", () => {
    deepStrictEqual(
      searches.map(launch => launch.environment),
      searches.map(launch => ({
        PATH: '<run>/clients/path:<path>',
        HARNESS_CLIENT_CASE: launch.label,
        ...(launch.label === 'client-tilde' ? {HOME: '<run>/home'} : {}),
      })),
    );
  });

  it("coverage-11: an unset setting leaves remote.SSH.path out of the launch's settings", () => {
    deepStrictEqual(
      searches.find(launch => launch.label === 'client-unset')?.settings,
      {},
    );
  });

  it('coverage-11: an empty setting is written as an empty path', () => {
    deepStrictEqual(
      searches.find(launch => launch.label === 'client-empty')?.settings,
      {'remote.SSH.path': ''},
    );
  });

  it('coverage-11: the two Windows cases differ only in the warning setting', () => {
    deepStrictEqual(
      ['client-windows', 'client-windows-suppressed'].map(
        label =>
          searches.find(launch => launch.label === label)?.settings?.[
            'remote.SSH.suppressWindowsSshWarning'
          ],
      ),
      [false, true],
    );
  });

  it('coverage-11: every case cites a criterion of F-2101', () => {
    deepStrictEqual(
      clientCases(REPOSITORY_ROOT).filter(
        each => !/^F-2101 AC-\d+$/.test(each.cite),
      ),
      [],
    );
  });
});

describe('the run tokens (card coverage-11)', () => {
  it('coverage-11: <run> and <path> are replaced at any depth', () => {
    deepStrictEqual(
      withRunTokens(
        {
          first: '<run>/x',
          second: ['<path>', 3, {third: '<run>:<path>'}],
          fourth: true,
        },
        '/run',
        '/bin',
      ),
      {
        first: '/run/x',
        second: ['/bin', 3, {third: '/run:/bin'}],
        fourth: true,
      },
    );
  });

  it('coverage-11: a value without a token is unchanged, and so is null', () => {
    deepStrictEqual(
      [
        withRunTokens('plain', '/run', '/bin'),
        withRunTokens(null, '/run', '/bin'),
      ],
      ['plain', null],
    );
  });

  it('coverage-11: a label that is not in the form of an alias is refused', () => {
    const workspace = new TemporaryWorkspace('client-cases');
    try {
      workspace.write(
        'tests/acceptance/suite-client/cases.json',
        JSON.stringify({
          cases: [
            {
              label: 'Client',
              cite: 'F-2101 AC-1',
              setting: null,
              checked: [],
              used: 'x',
            },
          ],
        }),
      );
      throws(() => clientCases(workspace.root), /label must match/);
    } finally {
      workspace.remove();
    }
  });
});

describe('the launch with no runner', () => {
  const launches = launchesOf(REPOSITORY_ROOT);

  it('D-85: the windows launch is plain and has a suite folder of Node tests', () => {
    deepStrictEqual(
      launches.filter(launch => launch.label === 'windows'),
      [{label: 'windows', kind: 'plain', suite: 'windows'}],
    );
  });

  it('F-3903 §5 rule 4: the no-proposals launch is plain and starts the editor without the proposed API', () => {
    deepStrictEqual(
      launches.filter(launch => launch.label === 'no-proposals'),
      [
        {
          label: 'no-proposals',
          kind: 'plain',
          suite: 'no-proposals',
          proposedApi: false,
        },
      ],
    );
  });

  it('F-3903 §5 rule 4: only the two no-proposals launches leave the proposed API out', () => {
    deepStrictEqual(
      launches
        .filter(launch => launch.proposedApi === false)
        .map(launch => launch.label),
      ['no-proposals', 'explorer-no-proposals'],
    );
  });

  it('D-85: the launches with a runner leave out the plain one', () => {
    deepStrictEqual(
      runnerLaunches(launches).filter(launch => launch.label === 'windows'),
      [],
    );
  });

  it('D-85: a plain launch is bundled into no folder', () => {
    deepStrictEqual(
      suitesOf(launches).filter(suite => suite === 'windows'),
      [],
    );
  });
});

describe('the suites of the launches', () => {
  it('D-85: the shared suite comes first and a suite shared by launches is listed once', () => {
    deepStrictEqual(
      suitesOf([
        {label: 'one', runner: 'runner', suite: 'suite-a'},
        {label: 'two', runner: 'runner', suite: 'suite-a'},
        {label: 'three', runner: 'runner', suite: 'suite-b'},
      ]),
      ['suite', 'suite-a', 'suite-b'],
    );
  });

  it('D-85: the suites of the repository hold suite-terminal once', () => {
    deepStrictEqual(
      suitesOf(launchesOf(REPOSITORY_ROOT)).filter(
        suite => suite === 'suite-terminal',
      ),
      ['suite-terminal'],
    );
  });

  it('D-85: the shared suite is bundled into dist', () => {
    deepStrictEqual(bundleFolderOf('suite'), 'dist');
  });

  it('D-85: a launch suite is bundled into dist-<name>', () => {
    deepStrictEqual(bundleFolderOf('suite-terminal'), 'dist-terminal');
  });
});

describe('the further extensions of the launches', () => {
  it('D-85: the repository loads the slow extension once', () => {
    deepStrictEqual(extensionsOf(launchesOf(REPOSITORY_ROOT)), ['slow-remote']);
  });

  it('D-85: an extension two launches load is listed once', () => {
    deepStrictEqual(
      extensionsOf([
        {label: 'one', runner: 'runner', suite: 's', extraExtensions: ['a']},
        {
          label: 'two',
          runner: 'runner',
          suite: 's',
          extraExtensions: ['a', 'b'],
        },
      ]),
      ['a', 'b'],
    );
  });
});
