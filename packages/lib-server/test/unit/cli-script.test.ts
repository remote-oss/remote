import {deepStrictEqual} from 'node:assert';
import {spawn, spawnSync} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  parseResult,
  type ResultBlock,
  scriptFor,
  type ScriptParameters,
} from '../../src/index.ts';
import {
  blockOf,
  fakeHost,
  type FakeHost,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';

/** The name of the CLI parameters' property, which the card fixes and is shorter than the identifier floor. */
const CLI_PROPERTY = 'cli';

const CLI_NAME = 'codium-insiders-abc123';

/** The CLI stand-in: it prints its ready line unless told to fail, records its environment, and stays up. */
const STAND_IN_CLI = [
  '#!/bin/sh',
  'echo "$*" >"$CLI_ARGUMENTS"',
  'echo "${VSCODE_CLI_REQUIRE_TOKEN:-}" >"$CLI_TOKEN"',
  '[ -z "$CLI_PID_FILE" ] || echo $$ >"$CLI_PID_FILE"',
  '[ -z "$CLI_EXIT" ] || exit "$CLI_EXIT"',
  '[ -z "$CLI_NOISE" ] || echo "$CLI_NOISE"',
  '[ "$CLI_SILENT" = yes ] || echo "Listening on 127.0.0.1:${CLI_PORT:-41234}"',
  'sleep 20',
].join('\n');

function cliParameters(host: FakeHost): ScriptParameters {
  const parameters = parametersFor();
  parameters.launcher = 'codium-insiders';
  return {
    ...parameters,
    [CLI_PROPERTY]: {
      name: CLI_NAME,
      dataFolder: path.join(host.home, '.server-data', 'cli'),
    },
  };
}

/** An archive that holds the stand-in CLI as its one file. */
function cliArchive(host: FakeHost, name = 'codium-insiders'): string {
  const folder = path.join(path.dirname(host.archive), 'cli-source');
  mkdirSync(folder, {recursive: true});
  writeFileSync(path.join(folder, name), `${STAND_IN_CLI}\n`);
  chmodSync(path.join(folder, name), 0o644);
  const archive = path.join(path.dirname(host.archive), 'cli.tar.gz');
  spawnSync('tar', ['-czf', archive, '-C', folder, name]);
  return archive;
}

function dataFolder(host: FakeHost): string {
  return path.join(host.home, '.server-data');
}

function placed(host: FakeHost, archive?: string): ScriptParameters {
  const parameters = {
    ...cliParameters(host),
    archivePath: archive ?? cliArchive(host),
  };
  runScript(host, single('installCli'), parameters);
  return parameters;
}

describe('the CLI steps of the bootstrap script (card cli-03b, contracts V7a)', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = fakeHost();
    host.environment.CLI_ARGUMENTS = path.join(
      path.dirname(host.archive),
      'cli-arguments.txt',
    );
    host.environment.CLI_TOKEN = path.join(
      path.dirname(host.archive),
      'cli-token.txt',
    );
  });

  describe('the parameter block', () => {
    it('brief §3: holds the CLI name and its data folder', () => {
      const lines = scriptFor(single('installCli'), 'posixShell', {
        ...parametersFor(),
        ['cli']: {name: 'codium-insiders-c1', dataFolder: '/h/.d/cli'},
      }).split('\n');
      deepStrictEqual(
        lines.filter(
          line => line.startsWith('CLI_NAME=') || line.startsWith('CLI_DATA='),
        ),
        ["CLI_NAME='codium-insiders-c1'", "CLI_DATA='/h/.d/cli'"],
      );
    });

    it('brief §3: both are empty when there is no CLI', () => {
      const lines = scriptFor(
        single('install'),
        'posixShell',
        parametersFor(),
      ).split('\n');
      deepStrictEqual(
        lines.filter(
          line => line.startsWith('CLI_NAME=') || line.startsWith('CLI_DATA='),
        ),
        ["CLI_NAME=''", "CLI_DATA=''"],
      );
    });
  });

  describe('startCli', () => {
    function startText(): string {
      return scriptFor(single('startCli'), 'posixShell', cliParameters(host));
    }

    it('V7a: the command is command-shell on the loopback address, a free port and its own data folder', () => {
      deepStrictEqual(
        startText().includes(
          'command-shell --on-host 127.0.0.1 --on-port 0 --cli-data-dir "$CLI_DATA" --parent-process-id "$PPID"',
        ),
        true,
      );
    });

    it('V7a: the command line has no token option', () => {
      deepStrictEqual(startText().includes('--require-token'), false);
    });

    it('themis on #430: the token test comes before the line that starts the CLI', () => {
      const text = startText();
      const guardAt = text.indexOf('VSCODE_CLI_REQUIRE_TOKEN');
      deepStrictEqual(guardAt >= 0 && guardAt < text.indexOf('nohup '), true);
    });

    it('themis on #430: with an empty environment the CLI is not started and the block says so', () => {
      const parameters = placed(host);
      const block = blockOf(host, single('startCli'), parameters);
      deepStrictEqual(
        block === 'none' ? block : [block.status, block.cliFacts.tokenMissing],
        ['ServerFailedToStart', 'yes'],
      );
    });

    it('themis on #430: with an empty environment a marker-writing CLI never runs', () => {
      placed(host);
      runScript(host, single('startCli'), cliParameters(host));
      deepStrictEqual(existsSync(host.environment.CLI_ARGUMENTS ?? ''), false);
    });

    it('V7a: with the token it reports the port, the process and the log', () => {
      const parameters = placed(host);
      const block = blockOf(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'},
      });
      deepStrictEqual(
        block === 'none'
          ? block
          : [
              block.status,
              block.cliFacts.port,
              Number(block.cliFacts.pid) > 1,
              block.cliFacts.log,
            ],
        ['Ok', '41234', true, path.join(dataFolder(host), '.cli.abc123.log')],
      );
    });

    it('V7a: the CLI receives the token in its environment and no token on its command line', () => {
      const parameters = placed(host);
      runScript(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'},
      });
      deepStrictEqual(
        [
          readFileSync(host.environment.CLI_TOKEN ?? '', 'utf8').trim(),
          readFileSync(host.environment.CLI_ARGUMENTS ?? '', 'utf8').includes(
            'tok-xyz',
          ),
        ],
        ['tok-xyz', false],
      );
    });

    it('V7a: the CLI is given the process id of the shell that runs the step as its parent', () => {
      const parameters = placed(host);
      runScript(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'},
      });
      deepStrictEqual(
        /--parent-process-id [1-9][0-9]*( |$)/.test(
          readFileSync(host.environment.CLI_ARGUMENTS ?? '', 'utf8').trim(),
        ),
        true,
      );
    });

    it('V7a: the token is not a fact of the block', () => {
      const parameters = placed(host);
      const output = runScript(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'},
      });
      deepStrictEqual(
        output.some(line => line.includes('tok-xyz')),
        false,
      );
    });

    it('themis on #430: a token that is set but empty is refused like a missing one', () => {
      const parameters = placed(host);
      const block = blockOf(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: ''},
      });
      deepStrictEqual(
        block === 'none' ? block : [block.status, block.cliFacts.tokenMissing],
        ['ServerFailedToStart', 'yes'],
      );
    });

    it('V7a: the CLI log is readable by its user alone', () => {
      const parameters = placed(host);
      runScript(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'},
      });
      deepStrictEqual(
        spawnSync(
          'stat',
          ['-c', '%a', path.join(dataFolder(host), '.cli.abc123.log')],
          {encoding: 'utf8'},
        ).stdout.trim(),
        '600',
      );
    });

    it('V7a: a CLI that never becomes ready is stopped when the wait ends', () => {
      const parameters = placed(host);
      parameters.start.readySeconds = 1;
      const pidFile = path.join(path.dirname(host.archive), 'cli-pid.txt');
      runScript(host, single('startCli'), parameters, {
        environment: {
          VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz',
          CLI_SILENT: 'yes',
          CLI_PID_FILE: pidFile,
        },
      });
      const processId = readFileSync(pidFile, 'utf8').trim();
      const state = spawnSync('ps', ['-o', 'stat=', '-p', processId], {
        encoding: 'utf8',
      }).stdout.trim();
      // A killed process is gone, or only a zombie that its parent has not collected.
      deepStrictEqual(state === '' || state.startsWith('Z'), true);
    });

    it('V7a: a CLI that exits first is ServerFailedToStart', () => {
      const parameters = placed(host);
      const block = blockOf(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz', CLI_EXIT: '3'},
      });
      deepStrictEqual(
        block === 'none' ? block : block.status,
        'ServerFailedToStart',
      );
    });

    it('V7a: a CLI that never says it listens is ServerFailedToStart when the wait ends', () => {
      const parameters = placed(host);
      parameters.start.readySeconds = 1;
      const block = blockOf(host, single('startCli'), parameters, {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz', CLI_SILENT: 'yes'},
      });
      deepStrictEqual(
        block === 'none' ? block : block.status,
        'ServerFailedToStart',
      );
    });

    it('V7a: a line that only contains the ready words is not the ready line', () => {
      const parameters = placed(host);
      parameters.start.readySeconds = 1;
      const block = blockOf(host, single('startCli'), parameters, {
        environment: {
          VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz',
          CLI_SILENT: 'yes',
          CLI_NOISE: 'x Listening on 127.0.0.1:999',
        },
      });
      deepStrictEqual(
        block === 'none' ? block : block.status,
        'ServerFailedToStart',
      );
    });

    it('V7a: a CLI that is not placed is ServerFailedToStart', () => {
      const block = blockOf(host, single('startCli'), cliParameters(host), {
        environment: {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'},
      });
      deepStrictEqual(
        block === 'none' ? block : block.status,
        'ServerFailedToStart',
      );
    });
  });

  describe('the host connection token (card cli-07)', () => {
    const TOKEN_ENVIRONMENT = {VSCODE_CLI_REQUIRE_TOKEN: 'tok-xyz'};

    function tokenFile(): string {
      return path.join(dataFolder(host), 'cli', 'connection-token');
    }

    /** The block of one start with the control token set. */
    function started(parameters: ScriptParameters): ResultBlock | 'none' {
      return blockOf(host, single('startCli'), parameters, {
        environment: TOKEN_ENVIRONMENT,
      });
    }

    /** A start run in the background, for two at once: its output lines. */
    function startedTogether(parameters: ScriptParameters): Promise<string[]> {
      return new Promise(resolve => {
        const child = spawn('/bin/sh', ['-s'], {
          env: {...host.environment, ...TOKEN_ENVIRONMENT},
        });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        child.on('close', () => {
          resolve(output.split('\n'));
        });
        child.stdin.end(
          scriptFor(single('startCli'), 'posixShell', parameters),
        );
      });
    }

    /** A token file made by hand with `text` and `mode`, in place of the one the start would make. */
    function plantedToken(text: string, mode: number): void {
      mkdirSync(path.dirname(tokenFile()), {recursive: true});
      writeFileSync(tokenFile(), text);
      chmodSync(tokenFile(), mode);
    }

    it('F-2409 BR-11: the first start makes a private token of 32 characters, and reports it', () => {
      const block = started(placed(host));
      deepStrictEqual(
        block === 'none'
          ? block
          : [
              block.status,
              /^[A-Za-z0-9]{32}$/.test(block.cliFacts.connectionToken ?? ''),
              block.cliFacts.connectionToken ===
                readFileSync(tokenFile(), 'utf8'),
              statSync(tokenFile()).mode & 0o777,
            ],
        ['Ok', true, true, 0o600],
      );
    });

    it('F-2409 BR-11: a second start reports the same token and leaves the file as it was', () => {
      const parameters = placed(host);
      const first = started(parameters);
      const second = started(parameters);
      deepStrictEqual(
        first === 'none' || second === 'none'
          ? 'none'
          : second.cliFacts.connectionToken === first.cliFacts.connectionToken,
        true,
      );
    });

    it('athena on #412: two starts at once report the same token', async () => {
      const parameters = placed(host);
      const outputs = await Promise.all([
        startedTogether(parameters),
        startedTogether(parameters),
      ]);
      const tokens = outputs.map(lines => {
        const parsed = parseResult(lines);
        return 'block' in parsed ? parsed.block.cliFacts.connectionToken : '';
      });
      deepStrictEqual(
        [
          tokens[0] !== '' && tokens[0] === tokens[1],
          tokens[0] === readFileSync(tokenFile(), 'utf8'),
        ],
        [true, true],
      );
    });

    it('athena on #412: a file that holds no token is refused, never replaced', () => {
      const parameters = placed(host);
      plantedToken('bad token!', 0o600);
      const block = started(parameters);
      deepStrictEqual(
        block === 'none'
          ? block
          : [
              block.status,
              block.cliFacts.tokenInvalid,
              readFileSync(tokenFile(), 'utf8'),
            ],
        ['ServerFailedToStart', 'yes', 'bad token!'],
      );
    });

    it('themis on #524: a token file others can read is refused', () => {
      const parameters = placed(host);
      plantedToken('abcdefghijklmnopqrstuvwxyz012345', 0o644);
      const block = started(parameters);
      deepStrictEqual(
        block === 'none' ? block : [block.status, block.cliFacts.tokenInvalid],
        ['ServerFailedToStart', 'yes'],
      );
    });

    it('themis on #524: a token file that is a link is refused', () => {
      const parameters = placed(host);
      const elsewhere = path.join(
        path.dirname(host.archive),
        'elsewhere-token',
      );
      writeFileSync(elsewhere, 'abcdefghijklmnopqrstuvwxyz012345');
      chmodSync(elsewhere, 0o600);
      mkdirSync(path.dirname(tokenFile()), {recursive: true});
      symlinkSync(elsewhere, tokenFile());
      const block = started(parameters);
      deepStrictEqual(
        block === 'none' ? block : [block.status, block.cliFacts.tokenInvalid],
        ['ServerFailedToStart', 'yes'],
      );
    });

    it('themis on #524: when no token file can be made, the start fails and reports none', () => {
      const parameters = placed(host);
      mkdirSync(path.dirname(tokenFile()), {recursive: true});
      chmodSync(path.dirname(tokenFile()), 0o500);
      const block = started(parameters);
      chmodSync(path.dirname(tokenFile()), 0o700);
      deepStrictEqual(
        block === 'none'
          ? block
          : [block.status, block.cliFacts.connectionToken],
        ['ServerFailedToStart', undefined],
      );
    });

    it('§S10: the start script makes the folder and the token file under umask 077, and links only a whole token', () => {
      const text = scriptFor(
        single('startCli'),
        'posixShell',
        cliParameters(host),
      );
      deepStrictEqual(
        [
          text.includes('(umask 077; mkdir -p "$CLI_DATA")'),
          text.includes(
            "(umask 077; tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32",
          ),
          text.includes(
            '[ "$((TOKEN_LENGTH + 0))" -eq 32 ] && ln "$TOKEN_TEMPORARY" "$TOKEN_FILE"',
          ),
        ],
        [true, true, true],
      );
    });
  });

  describe('installCli', () => {
    function installBlock(
      parameters: ScriptParameters,
    ): ReturnType<typeof blockOf> {
      return blockOf(host, single('installCli'), parameters);
    }

    it('F-2103 POST-2: the CLI is the one executable file <data>/<name>', () => {
      const parameters = placed(host);
      deepStrictEqual(
        [
          existsSync(path.join(dataFolder(host), CLI_NAME)),
          spawnSync('test', ['-x', path.join(dataFolder(host), CLI_NAME)])
            .status,
          parameters[CLI_PROPERTY]?.name,
        ],
        [true, 0, CLI_NAME],
      );
    });

    it('F-2103 POST-2: no staging folder is left', () => {
      placed(host);
      deepStrictEqual(
        existsSync(path.join(dataFolder(host), 'cli-bin')),
        false,
      );
    });

    it('F-2103 BR-8: a CLI already placed is reported again without a staging folder', () => {
      const parameters = placed(host);
      const block = installBlock(parameters);
      deepStrictEqual(
        [
          block === 'none' ? block : [block.status, block.cliFacts.path],
          existsSync(path.join(dataFolder(host), 'cli-bin')),
        ],
        [['Ok', path.join(dataFolder(host), CLI_NAME)], false],
      );
    });

    it('F-2403: an archive without the launcher file is UnpackFailed', () => {
      const parameters = {
        ...cliParameters(host),
        archivePath: cliArchive(host, 'other-name'),
      };
      const block = installBlock(parameters);
      deepStrictEqual(block === 'none' ? block : block.status, 'UnpackFailed');
    });

    it('F-2403: an archive that is not an archive is UnpackFailed and leaves no staging folder', () => {
      const broken = path.join(path.dirname(host.archive), 'bad.tar.gz');
      writeFileSync(broken, 'not an archive');
      const block = installBlock({...cliParameters(host), archivePath: broken});
      deepStrictEqual(
        [
          block === 'none' ? block : block.status,
          existsSync(path.join(dataFolder(host), 'cli-bin')),
        ],
        ['UnpackFailed', false],
      );
    });

    it('F-2403: the host downloads the archive when it is given none', () => {
      const parameters = {
        ...cliParameters(host),
        archiveUrl: 'https://example.invalid/cli.tar.gz',
      };
      writeFileSync(
        host.environment.STUB_ARCHIVE ?? '',
        readFileSync(cliArchive(host)),
      );
      const block = installBlock(parameters);
      deepStrictEqual(
        [
          block === 'none' ? block : block.status,
          existsSync(path.join(dataFolder(host), CLI_NAME)),
        ],
        ['Ok', true],
      );
    });

    it('F-2403.BR-7: a failed download is ServerDownloadFailed and leaves no staging folder', () => {
      const block = blockOf(host, single('installCli'), cliParameters(host), {
        environment: {STUB_FETCH_FAILS: 'yes'},
      });
      deepStrictEqual(
        [
          block === 'none' ? block : block.status,
          existsSync(path.join(dataFolder(host), 'cli-bin')),
        ],
        ['ServerDownloadFailed', false],
      );
    });

    it('F-2402: a host with neither downloader is NoDownloaderAvailable', () => {
      const bare = fakeHost([]);
      const block = blockOf(bare, single('installCli'), cliParameters(bare));
      deepStrictEqual(
        block === 'none' ? block : block.status,
        'NoDownloaderAvailable',
      );
    });

    it('V5: a busy host lock is LockBusy', () => {
      const parameters = {
        ...cliParameters(host),
        archivePath: cliArchive(host),
      };
      const binFolder = path.join(dataFolder(host), 'bin', 'abc123');
      mkdirSync(binFolder, {recursive: true});
      writeFileSync(path.join(binFolder, 'boot-lock.user.abc123.target'), '');
      writeFileSync(path.join(binFolder, 'boot-lock.user.abc123'), '');
      const block = installBlock(parameters);
      deepStrictEqual(block === 'none' ? block : block.status, 'LockBusy');
    });

    it('F-2403: an install with no CLI parameters is CreateInstallDirFailed', () => {
      const block = installBlock(parametersFor());
      deepStrictEqual(
        block === 'none' ? block : block.status,
        'CreateInstallDirFailed',
      );
    });
  });
});
