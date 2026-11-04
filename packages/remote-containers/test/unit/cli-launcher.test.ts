import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {buildArgumentsOf} from '../../src/cli-bin/build-arguments.ts';
import {
  BUILD_HELP_TEXT,
  OPEN_HELP_TEXT,
  topHelpOf,
} from '../../src/cli-bin/launcher-help.ts';
import {type LauncherPorts, runLauncher} from '../../src/cli-bin/launcher.ts';

describe('the build surface of the launcher (card containers-211)', () => {
  it('F-1201 AC-38: the positional folder, or --workspace-folder when both are given, becomes --workspace-folder', () => {
    deepStrictEqual(
      [
        buildArgumentsOf(['real']),
        buildArgumentsOf(['real', '--workspace-folder', 'other']),
        buildArgumentsOf(['--workspace-folder=other', 'real']),
        buildArgumentsOf([]),
      ],
      [
        {kind: 'build', forwarded: ['--workspace-folder', 'real']},
        {kind: 'build', forwarded: ['--workspace-folder', 'other']},
        {kind: 'build', forwarded: ['--workspace-folder', 'other']},
        {kind: 'build', forwarded: []},
      ],
    );
  });

  it('F-1201 AC-38: --verbose is debug output unless --log-level is given, and --disable-telemetry is accepted and dropped', () => {
    deepStrictEqual(
      [
        buildArgumentsOf(['--verbose', '--disable-telemetry']),
        buildArgumentsOf(['--verbose', '--log-level', 'trace']),
        buildArgumentsOf(['--log-level=info', '--verbose']),
      ],
      [
        {kind: 'build', forwarded: ['--log-level', 'debug']},
        {kind: 'build', forwarded: ['--log-level', 'trace']},
        {kind: 'build', forwarded: ['--log-level=info']},
      ],
    );
  });

  it('F-1201 AC-38: the options of the list pass on, valued ones with their value and flags alone', () => {
    deepStrictEqual(
      buildArgumentsOf([
        '--no-cache',
        '--image-name',
        'img',
        '--push',
        '--buildkit=never',
      ]),
      {
        kind: 'build',
        forwarded: [
          '--no-cache',
          '--image-name',
          'img',
          '--push',
          '--buildkit=never',
        ],
      },
    );
  });

  it('F-1201 AC-39, 7.E5: an option outside the list, or a second folder, is unknown by its name, and --help is the help', () => {
    deepStrictEqual(
      [
        buildArgumentsOf(['--label', 'a=b']),
        buildArgumentsOf(['--output=x']),
        buildArgumentsOf(['one', 'two']),
        buildArgumentsOf(['-h']),
        buildArgumentsOf(['--help']),
      ],
      [
        {kind: 'unknown', argument: 'label'},
        {kind: 'unknown', argument: 'output'},
        {kind: 'unknown', argument: 'two'},
        {kind: 'help'},
        {kind: 'help'},
      ],
    );
  });

  it('F-1201 AC-38: an option that takes a value and gets none is named', () => {
    deepStrictEqual(buildArgumentsOf(['--config']), {
      kind: 'missing',
      option: 'config',
    });
  });
});

describe('the help of the launcher (card containers-211)', () => {
  it('F-1201 AC-31: the help of open names the positional with its default, --disable-telemetry and --config with their texts', () => {
    deepStrictEqual(
      [
        OPEN_HELP_TEXT.startsWith(
          'devcontainer open [path]\n\nOpen a dev container in VS Code\n',
        ),
        OPEN_HELP_TEXT.includes('path to project folder'),
        OPEN_HELP_TEXT.includes('[default: "."]'),
        OPEN_HELP_TEXT.includes('Disable telemetry'),
        OPEN_HELP_TEXT.includes(
          'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.',
        ),
      ],
      [true, true, true, true, true],
    );
  });

  it('F-1201 AC-38: the help of build names its texts and lists the options in order, the open CLI’s newer ones absent', () => {
    const names = [
      ...BUILD_HELP_TEXT.matchAll(/^ {2}(-h, --help|--[a-z-]+)/gm),
    ].map(each => each[1]);
    deepStrictEqual(
      [
        BUILD_HELP_TEXT.includes(
          'path to folder containing .devcontainer to build',
        ),
        BUILD_HELP_TEXT.includes('Run build with increased log level'),
        names,
      ],
      [
        true,
        true,
        [
          '-h, --help',
          '--disable-telemetry',
          '--verbose',
          '--user-data-folder',
          '--docker-path',
          '--docker-compose-path',
          '--workspace-folder',
          '--config',
          '--log-level',
          '--log-format',
          '--no-cache',
          '--image-name',
          '--cache-from',
          '--buildkit',
          '--platform',
          '--push',
        ],
      ],
    );
  });

  it('F-1201 AC-31: the top help lists open first among the CLI’s commands and ends with the CLI’s version and the install folder; a help with no command list is kept', () => {
    const cliHelp =
      'devcontainer <command>\n\nCommands:\n  devcontainer up  Create\n\nOptions:\n  --help\n';
    deepStrictEqual(
      [
        topHelpOf(cliHelp, '0.89.0', '/ext'),
        topHelpOf('plain\n', '0.89.0', '/ext'),
      ],
      [
        'devcontainer <command>\n\nCommands:\n  devcontainer open [path]          Open a dev container in VS Code\n  devcontainer up  Create\n\nOptions:\n  --help\n\ndevcontainer@0.89.0 /ext\n',
        'plain\n\ndevcontainer@0.89.0 /ext\n',
      ],
    );
  });
});

/** A launcher over a machine in memory, and what it did. */
function launcherOf(
  files: Readonly<Record<string, string>> = {},
  folders: readonly string[] = [],
) {
  const printed: string[] = [];
  const complaints: string[] = [];
  const cliCalls: string[][] = [];
  const launched: string[] = [];
  const ports: LauncherPorts = {
    current: '/work',
    flavor: path.posix,
    environment: {},
    kindOf: target =>
      Promise.resolve(
        folders.includes(target)
          ? 'folder'
          : target in files
            ? 'file'
            : 'missing',
      ),
    readText: file => Promise.resolve(files[file]),
    extensionPath: '/ext',
    elapsed: () => 12,
    system: {
      nodeVersion: 'v24.1.0',
      platform: 'linux',
      release: '7.2.15',
      arch: 'x64',
    },
    stdout: text => printed.push(text),
    stderr: text => complaints.push(text),
    cliOutput: argv =>
      Promise.resolve(
        argv[0] === '--version' ? '0.89.0\n' : 'Commands:\n  devcontainer up\n',
      ),
    runCli: argv => {
      cliCalls.push([...argv]);
      return Promise.resolve(argv[0] === 'fails' ? 3 : 0);
    },
    launchEditor: address => launched.push(address),
  };
  return {ports, printed, complaints, cliCalls, launched};
}

const PROJECT = '/work/proj';
const CONFIG = `${PROJECT}/.devcontainer/devcontainer.json`;

describe('the launcher’s commands (card containers-211)', () => {
  it('F-1201 AC-32: open prints one banner line and launches the editor on the folder’s address, exiting 0', async () => {
    const session = launcherOf({[CONFIG]: '{}'}, [PROJECT]);
    const status = await runLauncher(['open', 'proj'], session.ports);
    deepStrictEqual(
      [
        status,
        session.complaints,
        session.launched.map(address =>
          address.replace(/dev-container%2B[0-9a-f]+/, 'dev-container%2B<hex>'),
        ),
        session.cliCalls,
      ],
      [
        0,
        [
          '\u001b[1m[12 ms] @devcontainers/cli 0.89.0. Node.js v24.1.0. linux 7.2.15 x64.\u001b[22m\n',
        ],
        ['vscode-remote://dev-container%2B<hex>/workspaces/proj'],
        [],
      ],
    );
  });

  it('F-1201 AC-35, AC-44: open of a folder with no usable configuration says why on stderr, exits 1 and launches nothing', async () => {
    const session = launcherOf({}, [PROJECT]);
    const status = await runLauncher(['open', 'proj'], session.ports);
    deepStrictEqual(
      [status, session.complaints, session.launched],
      [1, ['/work/proj has no dev container configuration file\n'], []],
    );
  });

  it('F-1201 AC-49: open with a second positional argument prints the help after "Unknown argument", exits 1 and launches nothing; --help and a missing --config value are told too', async () => {
    const session = launcherOf({[CONFIG]: '{}'}, [PROJECT]);
    const statuses = [
      await runLauncher(['open', 'proj', 'trail'], session.ports),
      await runLauncher(['open', '--help'], session.ports),
      await runLauncher(['open', 'proj', '--config'], session.ports),
    ];
    deepStrictEqual(
      [statuses, session.complaints, session.printed, session.launched],
      [
        [1, 0, 1],
        [
          `${OPEN_HELP_TEXT}\nUnknown argument: trail\n`,
          `${OPEN_HELP_TEXT}\nNot enough arguments following: config\n`,
        ],
        [OPEN_HELP_TEXT],
        [],
      ],
    );
  });

  it('F-1201 AC-38: build runs the CLI’s build on the translated arguments and gives its status', async () => {
    const session = launcherOf();
    const status = await runLauncher(
      ['build', 'real', '--verbose'],
      session.ports,
    );
    deepStrictEqual(
      [status, session.cliCalls],
      [0, [['build', '--workspace-folder', 'real', '--log-level', 'debug']]],
    );
  });

  it('F-1201 AC-39: build with an option outside the list prints its help and Unknown argument, exits 1 and builds nothing; --help and a missing value are told too', async () => {
    const session = launcherOf();
    const statuses = [
      await runLauncher(['build', '--label', 'a=b'], session.ports),
      await runLauncher(['build', '--help'], session.ports),
      await runLauncher(['build', '--config'], session.ports),
    ];
    deepStrictEqual(
      [statuses, session.complaints, session.printed, session.cliCalls],
      [
        [1, 0, 1],
        [
          `${BUILD_HELP_TEXT}\nUnknown argument: label\n`,
          `${BUILD_HELP_TEXT}\nNot enough arguments following: config\n`,
        ],
        [BUILD_HELP_TEXT],
        [],
      ],
    );
  });

  it('F-1201 AC-31: no command, --help and -h print the topLine help with open first; any other command goes to the CLI unchanged with its status', async () => {
    const session = launcherOf();
    const statuses = [
      await runLauncher([], session.ports),
      await runLauncher(['--help'], session.ports),
      await runLauncher(['-h'], session.ports),
      await runLauncher(['fails', '--x', 'y z'], session.ports),
    ];
    const topLine = session.printed[0] ?? '';
    deepStrictEqual(
      [
        statuses,
        session.printed.length,
        topLine.includes('devcontainer open [path]'),
        topLine.endsWith('devcontainer@0.89.0 /ext\n'),
        session.cliCalls,
      ],
      [[0, 0, 0, 3], 3, true, true, [['fails', '--x', 'y z']]],
    );
  });
});
