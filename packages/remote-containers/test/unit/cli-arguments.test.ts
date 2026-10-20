import {deepStrictEqual} from 'node:assert';
import {
  type CliTarget,
  readConfigurationArguments,
  runUserCommandsArguments,
  upArguments,
  type UpOptions,
} from '../../src/cli/cli-arguments.ts';

const TARGET: CliTarget = {
  workspaceFolder: '/work/ws1',
  configFile: '/work/ws1/.devcontainer/devcontainer.json',
  dockerPath: 'docker',
  idLabels: [
    'devcontainer.local_folder=/work/ws1',
    'devcontainer.config_file=/work/ws1/.devcontainer/devcontainer.json',
  ],
  mountWorkspaceGitRoot: true,
  mountGitWorktreeCommonDir: false,
  features: {defaultFeatures: {}, lockfile: true},
  mounts: [],
  logLevel: 'info',
};

const PLAIN: UpOptions = {
  removeExistingContainer: false,
  buildNoCache: false,
  workspaceMountConsistency: 'cached',
};

const COMMON = [
  '--workspace-folder',
  '/work/ws1',
  '--config',
  '/work/ws1/.devcontainer/devcontainer.json',
  '--id-label',
  'devcontainer.local_folder=/work/ws1',
  '--id-label',
  'devcontainer.config_file=/work/ws1/.devcontainer/devcontainer.json',
  '--docker-path',
  'docker',
  '--log-level',
  'info',
  '--log-format',
  'json',
];

describe('the arguments of the dev container CLI (card containers-04)', () => {
  it('C3: up for the release-1 target is the whole list in the fixed order', () => {
    deepStrictEqual(upArguments(TARGET, PLAIN), [
      'up',
      ...COMMON,
      '--skip-non-blocking-commands',
      '--workspace-mount-consistency',
      'cached',
    ]);
  });

  it('C3: removing the existing container and building without the cache add their flags after the consistency', () => {
    deepStrictEqual(
      upArguments(TARGET, {
        ...PLAIN,
        removeExistingContainer: true,
        buildNoCache: true,
      }).slice(-5),
      [
        '--skip-non-blocking-commands',
        '--workspace-mount-consistency',
        'cached',
        '--remove-existing-container',
        '--build-no-cache',
      ],
    );
  });

  it('C3: a workspace not mounted from the git root adds its flag, and the default adds nothing', () => {
    deepStrictEqual(
      [true, false].map(mountWorkspaceGitRoot =>
        upArguments({...TARGET, mountWorkspaceGitRoot}, PLAIN).filter(
          argument => argument.startsWith('--mount-workspace-git-root'),
        ),
      ),
      [[], ['--mount-workspace-git-root=false']],
    );
  });

  it('C3: an override file follows the config right away', () => {
    deepStrictEqual(
      upArguments({...TARGET, overrideConfigFile: '/s/o.json'}, PLAIN).slice(
        1,
        7,
      ),
      [
        '--workspace-folder',
        '/work/ws1',
        '--config',
        '/work/ws1/.devcontainer/devcontainer.json',
        '--override-config',
        '/s/o.json',
      ],
    );
  });

  it('C3: mounts give a pair each in up, in order, and none in the other builders', () => {
    const mounted = {
      ...TARGET,
      mounts: [
        'type=volume,source=vscode,target=/vscode',
        'type=bind,source=/a,target=/b',
      ],
    };
    deepStrictEqual(
      [
        upArguments(mounted, PLAIN).filter(
          (argument, index, all) => all[index - 1] === '--mount',
        ),
        runUserCommandsArguments(mounted, 'c1').includes('--mount'),
        readConfigurationArguments(mounted).includes('--mount'),
        upArguments(TARGET, PLAIN).includes('--mount'),
      ],
      [
        [
          'type=volume,source=vscode,target=/vscode',
          'type=bind,source=/a,target=/b',
        ],
        false,
        false,
        false,
      ],
    );
  });

  it('C3: run-user-commands ends with the container id and has no skip flag', () => {
    const list = runUserCommandsArguments(TARGET, 'abc');
    deepStrictEqual(
      [list.slice(-2), list.includes('--skip-non-blocking-commands')],
      [['--container-id', 'abc'], false],
    );
  });

  it('F-0410 AC-13: read-configuration asks for the merged configuration only together with a container id', () => {
    deepStrictEqual(
      [
        readConfigurationArguments(TARGET),
        readConfigurationArguments(TARGET, 'abc'),
      ].map(list => list.slice(-3)),
      [
        ['info', '--log-format', 'json'],
        ['--container-id', 'abc', '--include-merged-configuration'],
      ],
    );
  });

  it('F-0411 3.2: the worktree flag is in all three subcommands when the setting is on, and in none when it is off', () => {
    function flagsIn(mountGitWorktreeCommonDir: boolean): string[][] {
      const target = {...TARGET, mountGitWorktreeCommonDir};
      return [
        upArguments(target, PLAIN),
        runUserCommandsArguments(target, 'abc'),
        readConfigurationArguments(target),
      ].map(list =>
        list.filter(argument => argument === '--mount-git-worktree-common-dir'),
      );
    }
    deepStrictEqual(
      [flagsIn(true), flagsIn(false)],
      [
        [
          ['--mount-git-worktree-common-dir'],
          ['--mount-git-worktree-common-dir'],
          ['--mount-git-worktree-common-dir'],
        ],
        [[], [], []],
      ],
    );
  });

  it('F-0411 3.2: the worktree flag comes right after the git-root flag\u2019s place, before the log level', () => {
    deepStrictEqual(
      readConfigurationArguments({
        ...TARGET,
        mountWorkspaceGitRoot: false,
        mountGitWorktreeCommonDir: true,
        features: {defaultFeatures: {}, lockfile: true},
      }).slice(-6, -2),
      [
        '--mount-workspace-git-root=false',
        '--mount-git-worktree-common-dir',
        '--log-level',
        'info',
      ],
    );
  });

  it('F-0411 BR-7, 7.E5: the consistency is in up only, with its value as written', () => {
    deepStrictEqual(
      [
        ...['consistent', 'delegated', 'fast'].map(workspaceMountConsistency =>
          upArguments(TARGET, {...PLAIN, workspaceMountConsistency}).slice(-2),
        ),
        runUserCommandsArguments(TARGET, 'abc').includes(
          '--workspace-mount-consistency',
        ),
        readConfigurationArguments(TARGET, 'abc').includes(
          '--workspace-mount-consistency',
        ),
      ],
      [
        ['--workspace-mount-consistency', 'consistent'],
        ['--workspace-mount-consistency', 'delegated'],
        ['--workspace-mount-consistency', 'fast'],
        false,
        false,
      ],
    );
  });

  it('ADR-0011: a terminal size adds --terminal-rows and --terminal-columns after the log format, for the three subcommands', () => {
    const sized: CliTarget = {...TARGET, terminalSize: {rows: 24, columns: 80}};
    const builders = [
      (target: CliTarget) => upArguments(target, PLAIN),
      (target: CliTarget) => runUserCommandsArguments(target, 'c1'),
      (target: CliTarget) => readConfigurationArguments(target, 'c1'),
    ];
    deepStrictEqual(
      builders.map(build => {
        const withSize = build(sized);
        const format = withSize.indexOf('--log-format');
        return [
          withSize.slice(format, format + 6),
          build(TARGET).includes('--terminal-rows'),
          build(TARGET).includes('--terminal-columns'),
        ];
      }),
      builders.map(() => [
        [
          '--log-format',
          'json',
          '--terminal-rows',
          '24',
          '--terminal-columns',
          '80',
        ],
        false,
        false,
      ]),
    );
  });

  it('C3: no builder emits --remote-env or --secrets-file', () => {
    const lists = [
      upArguments(TARGET, {
        ...PLAIN,
        removeExistingContainer: true,
        buildNoCache: true,
      }),
      runUserCommandsArguments(TARGET, 'abc'),
      readConfigurationArguments(TARGET, 'abc'),
    ];
    deepStrictEqual(
      lists
        .flat()
        .filter(argument =>
          ['--remote-env', '--secrets-file'].includes(argument),
        ),
      [],
    );
  });

  it('C3: a folder with spaces and quotes is one element, unchanged', () => {
    deepStrictEqual(
      upArguments({...TARGET, workspaceFolder: '/work/a b/"q"'}, PLAIN)[2],
      '/work/a b/"q"',
    );
  });

  it('F-0414 6.2, BR-9: default Features go to up and to the read of the configuration as JSON, and an empty setting passes nothing', () => {
    const features = {
      defaultFeatures: {'ghcr.io/devcontainers/features/node:1': {}},
      lockfile: true,
    };
    const json = JSON.stringify(features.defaultFeatures);
    deepStrictEqual(
      [
        upArguments({...TARGET, features}, PLAIN),
        readConfigurationArguments({...TARGET, features}),
        runUserCommandsArguments({...TARGET, features}, 'c1'),
      ],
      [
        [
          'up',
          ...COMMON,
          '--additional-features',
          json,
          '--skip-non-blocking-commands',
          '--workspace-mount-consistency',
          'cached',
        ],
        ['read-configuration', ...COMMON, '--additional-features', json],
        ['run-user-commands', ...COMMON, '--container-id', 'c1'],
      ],
    );
  });

  it('F-0414 6.3, BR-6: a lockfile setting of true passes no flag, since the CLI writes the lockfile by default, and false passes --no-lockfile to up alone', () => {
    const without = {
      ...TARGET,
      features: {defaultFeatures: {}, lockfile: false},
    };
    deepStrictEqual(
      [
        upArguments(TARGET, PLAIN).includes('--no-lockfile'),
        upArguments(without, PLAIN).includes('--no-lockfile'),
        readConfigurationArguments(without).includes('--no-lockfile'),
        upArguments(without, PLAIN).some(
          argument =>
            argument.includes('lockfile') && argument !== '--no-lockfile',
        ),
      ],
      [false, true, false, false],
    );
  });
});
