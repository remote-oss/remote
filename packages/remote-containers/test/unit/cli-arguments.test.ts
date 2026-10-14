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
  mounts: [],
  logLevel: 'info',
};

const PLAIN: UpOptions = {removeExistingContainer: false, buildNoCache: false};

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
    ]);
  });

  it('C3: removing the existing container and building without the cache add their flags after the skip flag', () => {
    deepStrictEqual(
      upArguments(TARGET, {
        removeExistingContainer: true,
        buildNoCache: true,
      }).slice(-3),
      [
        '--skip-non-blocking-commands',
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

  it('C3: read-configuration asks for the merged configuration, with or without a container id', () => {
    deepStrictEqual(
      [
        readConfigurationArguments(TARGET),
        readConfigurationArguments(TARGET, 'abc'),
      ].map(list => list.slice(-3)),
      [
        ['--log-format', 'json', '--include-merged-configuration'],
        ['--container-id', 'abc', '--include-merged-configuration'],
      ],
    );
  });

  it('C3: no builder emits --remote-env or --secrets-file', () => {
    const lists = [
      upArguments(TARGET, {removeExistingContainer: true, buildNoCache: true}),
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
});
