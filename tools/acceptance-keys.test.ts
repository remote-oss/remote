import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  agentEnvironment,
  agentSocketPath,
  changedKeyHostsFile,
  checkProtected,
  controlFolderOf,
  EMPTY_AGENT_VARIABLE,
  SOCKET_PATH_LIMIT,
  CERTIFIED_PRINCIPAL,
  makeRunKeys,
  PASSPHRASE_KEY_COMMENT,
  loosenKey,
  type RunKeys,
  sshConfigPath,
  startRunAgent,
  WINDOWS_AGENT_PIPE,
  writeAskpass,
} from './acceptance-keys.ts';
import {type CommandRunner, runCommand} from './command-runner.ts';

/** Runs a program with extra variables and gives its status and both outputs. */
function runProgram(
  program: string,
  programArguments: readonly string[],
  variables: Record<string, string> = {},
): {status: number | null; output: string} {
  const result = spawnSync(program, programArguments, {
    encoding: 'utf8',
    env: {...process.env, ...variables},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {status: result.status, output: `${result.stdout}${result.stderr}`};
}

/** The command lines `recording` ran. */
const commandLines: string[] = [];

/** Runs a command and keeps its command line. */
function recording(
  program: string,
  programArguments: readonly string[],
): ReturnType<CommandRunner> {
  commandLines.push([program, ...programArguments].join(' '));
  return runCommand(program, programArguments);
}

/** A command runner that keeps each command line in `commands` and whose every command succeeds, printing nothing. */
function succeedingInto(commands: string[]): CommandRunner {
  return (program, programArguments) => {
    commands.push([program, ...programArguments].join(' '));
    return {status: 0, stdout: '', stderr: ''};
  };
}

/** A command runner whose every command exits with `status` and prints nothing. */
function exitingWith(status: number): CommandRunner {
  return () => ({status, stdout: '', stderr: ''});
}

describe('makeRunKeys', function () {
  this.timeout(60000);
  let folder = '';
  let keys: RunKeys;

  before(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'run-keys-'));
    keys = makeRunKeys(recording, folder);
  });

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('tooling-29: the passphrase file and its askpass script are private to the owner', () => {
    deepStrictEqual(
      [
        statSync(keys.passphraseFile).mode & 0o777,
        statSync(keys.passphraseAskpass).mode & 0o777,
        readFileSync(keys.passphraseFile, 'utf8').length,
      ],
      [0o600, 0o700, 24],
    );
  });

  it('tooling-29: no command line carries the passphrase', () => {
    const passphrase = readFileSync(keys.passphraseFile, 'utf8');
    strictEqual(
      commandLines.some(line => line.includes(passphrase)),
      false,
    );
  });

  it("tooling-29: the passphrase key opens with the run's passphrase and not with an empty one", () => {
    const withPassphrase = runProgram(
      'ssh-keygen',
      ['-y', '-f', keys.passphraseKey],
      {
        SSH_ASKPASS: keys.passphraseAskpass,
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: '',
      },
    );
    const withEmpty = runProgram('ssh-keygen', [
      '-y',
      '-P',
      '',
      '-f',
      keys.passphraseKey,
    ]);
    deepStrictEqual(
      [
        withPassphrase.status,
        withPassphrase.output.startsWith('ssh-ed25519 '),
        withPassphrase.output.trim().endsWith(PASSPHRASE_KEY_COMMENT),
        withEmpty.status !== 0,
      ],
      [0, true, true, true],
    );
  });

  it("coverage-85: the changed-key alias's known-hosts file pins, under the alias's name, a key the host isn't given", () => {
    const [line = '', ...more] = readFileSync(
      changedKeyHostsFile(folder),
      'utf8',
    )
      .trimEnd()
      .split('\n');
    const [name, type, key] = line.split(' ');
    deepStrictEqual(
      [
        more.length,
        name,
        type,
        keys.hostArguments.some(argument => argument.includes(key ?? '-')),
      ],
      [0, 'changedkey', 'ssh-ed25519', false],
    );
  });

  it("tooling-29: the stranger key opens with the run's passphrase and isn't given to the host", () => {
    const opened = runProgram('ssh-keygen', ['-y', '-f', keys.strangerKey], {
      SSH_ASKPASS: keys.passphraseAskpass,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: '',
    });
    deepStrictEqual(
      [
        opened.status,
        keys.hostArguments.some(argument =>
          argument.includes(publicKeyOf(keys.strangerKey)),
        ),
      ],
      [0, false],
    );
  });

  it('tooling-29: the loose key is a copy of the second key that anyone may read', () => {
    deepStrictEqual(
      [
        statSync(keys.looseKey).mode & 0o777,
        readFileSync(keys.looseKey, 'utf8') ===
          readFileSync(keys.secondKey, 'utf8'),
      ],
      [0o644, true],
    );
  });

  it("tooling-29: the certificate is signed by the run's authority for harness-cert", () => {
    const listing = runProgram('ssh-keygen', [
      '-L',
      '-f',
      `${keys.certifiedKey}-cert.pub`,
    ]);
    deepStrictEqual(
      [
        listing.status,
        /Principals:\s+harness-cert/.test(listing.output),
        CERTIFIED_PRINCIPAL,
      ],
      [0, true, 'harness-cert'],
    );
  });

  it('coverage-96: the certified passphrase key needs the passphrase, and its certificate is for harness-cert', () => {
    deepStrictEqual(
      {
        opensWithout:
          runProgram('ssh-keygen', [
            '-y',
            '-P',
            '',
            '-f',
            keys.certifiedPassphraseKey,
          ]).status === 0,
        principal: /Principals:\s+harness-cert/.test(
          runProgram('ssh-keygen', [
            '-L',
            '-f',
            `${keys.certifiedPassphraseKey}-cert.pub`,
          ]).output,
        ),
      },
      {opensWithout: false, principal: true},
    );
  });

  it("coverage-19: the unauthorised key has no passphrase and isn't given to the host", () => {
    deepStrictEqual(
      [
        runProgram('ssh-keygen', ['-y', '-P', '', '-f', keys.unauthorisedKey])
          .status,
        keys.hostArguments.some(argument =>
          argument.includes(publicKeyOf(keys.unauthorisedKey)),
        ),
      ],
      [0, false],
    );
  });

  it('tooling-29, coverage-85: the host is given the passphrase and second public keys, the no-forwarding key with its option, and the authority', () => {
    deepStrictEqual(keys.hostArguments, [
      '--env',
      `AUTHORIZED_KEYS_FURTHER=${publicKeyOf(keys.passphraseKey)}\n${publicKeyOf(keys.secondKey)}\nno-port-forwarding ${publicKeyOf(keys.noForwardingKey)}`,
      '--env',
      `CA_PUBLIC_KEY=${publicKeyOf(path.join(folder, 'ca'))}`,
    ]);
  });
});

/** The public part of a key file. */
function publicKeyOf(file: string): string {
  return readFileSync(`${file}.pub`, 'utf8').trim();
}

describe('the run agent', function () {
  this.timeout(30000);

  it("tooling-29: the agent listens in the run's folder when that path is short enough", () => {
    strictEqual(agentSocketPath('/tmp/run'), '/tmp/run/agent.sock');
  });

  it('tooling-29: a run folder too deep for a Unix socket moves the agent to a short folder', () => {
    strictEqual(
      agentSocketPath(
        `/${'d'.repeat(SOCKET_PATH_LIMIT)}`,
        () => '/tmp/agent-x',
      ),
      '/tmp/agent-x/agent.sock',
    );
  });

  it('tooling-29: the short folder is made under /tmp', () => {
    const socket = agentSocketPath(`/${'d'.repeat(SOCKET_PATH_LIMIT)}`);
    rmSync(path.dirname(socket), {recursive: true, force: true});
    strictEqual(socket.startsWith('/tmp/agent-'), true);
  });

  it("coverage-16: the control sockets are in the run's folder when their longest name fits a Unix socket path", () => {
    strictEqual(controlFolderOf('/tmp/run'), '/tmp/run');
  });

  it("coverage-16: a runner's deep run folder moves the control sockets to a short folder", () => {
    strictEqual(
      controlFolderOf(
        '/home/runner/work/_temp/acceptance-38551981192-1-vscodium-AbCdEf',
        () => '/tmp/control-x',
      ),
      '/tmp/control-x',
    );
  });

  it('coverage-16: a folder whose longest socket name is exactly at the limit stays, and one byte more moves', () => {
    const fits = `/${'d'.repeat(SOCKET_PATH_LIMIT - 1 - 68 - 1)}`;
    strictEqual(
      [
        controlFolderOf(fits, () => 'short'),
        controlFolderOf(`${fits}d`, () => 'short'),
      ].join(),
      `${fits},short`,
    );
  });

  it('coverage-16: the short control folder is made under /tmp', () => {
    const folder = controlFolderOf(`/${'d'.repeat(SOCKET_PATH_LIMIT)}`);
    rmSync(folder, {recursive: true, force: true});
    strictEqual(folder.startsWith('/tmp/control-'), true);
  });

  it("tooling-118: on Windows the agent is the service's pipe, and no short folder is made", () => {
    strictEqual(
      agentSocketPath(
        `C:\\${'d'.repeat(SOCKET_PATH_LIMIT)}`,
        () => {
          throw new Error('a short folder was made');
        },
        'win32',
      ),
      '\\\\.\\pipe\\openssh-ssh-agent',
    );
  });

  it("tooling-118: on Windows the control folder is the run's folder, however deep", () => {
    strictEqual(
      controlFolderOf(
        `C:\\${'d'.repeat(SOCKET_PATH_LIMIT)}`,
        () => {
          throw new Error('a short folder was made');
        },
        'win32',
      ),
      `C:\\${'d'.repeat(SOCKET_PATH_LIMIT)}`,
    );
  });

  it("tooling-118: ssh_config's paths have forward slashes on Windows and stay as they are elsewhere", () => {
    deepStrictEqual(
      [
        sshConfigPath('C:\\Users\\runner\\run\\id_ed25519', 'win32'),
        sshConfigPath(WINDOWS_AGENT_PIPE, 'win32'),
        sshConfigPath('/tmp/run/id_ed25519', 'win32'),
        sshConfigPath('/tmp/run/a\\b', 'linux'),
        sshConfigPath('/tmp/run/a\\b', 'darwin'),
      ],
      [
        'C:/Users/runner/run/id_ed25519',
        '//./pipe/openssh-ssh-agent',
        '/tmp/run/id_ed25519',
        '/tmp/run/a\\b',
        '/tmp/run/a\\b',
      ],
    );
  });

  it("tooling-118: on Windows in CI the run empties the service's agent at its start and at its end, and starts no agent", async () => {
    const commands: string[] = [];
    const agent = startRunAgent(
      WINDOWS_AGENT_PIPE,
      'win32',
      succeedingInto(commands),
      {GITHUB_ACTIONS: 'true'},
    );
    const atStart = [...commands];
    await agent.stop();
    deepStrictEqual(
      [atStart, commands],
      [['ssh-add -D'], ['ssh-add -D', 'ssh-add -D']],
    );
  });

  it('tooling-118: on Windows outside CI the opt-in lets the run empty the agent', () => {
    const commands: string[] = [];
    startRunAgent(WINDOWS_AGENT_PIPE, 'win32', succeedingInto(commands), {
      [EMPTY_AGENT_VARIABLE]: '1',
    });
    deepStrictEqual(commands, ['ssh-add -D']);
  });

  it('tooling-118: on Windows outside CI without the opt-in the run stops before any ssh-add, naming the opt-in', () => {
    const commands: string[] = [];
    let message = '';
    try {
      startRunAgent(WINDOWS_AGENT_PIPE, 'win32', succeedingInto(commands), {
        GITHUB_ACTIONS: 'false',
        [EMPTY_AGENT_VARIABLE]: 'yes',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    deepStrictEqual(
      [message, commands],
      [
        "the run would empty this user's ssh-agent service (ssh-add -D) at its start and end; outside CI it does so only with REMOTE_OSS_ACCEPTANCE_EMPTY_AGENT=1",
        [],
      ],
    );
  });

  it('tooling-118: on Windows an agent service that is not running stops the run, naming ssh-add', () => {
    throws(
      () =>
        startRunAgent(
          WINDOWS_AGENT_PIPE,
          'win32',
          () => ({
            status: 2,
            stdout: '',
            stderr: 'Error connecting to agent: No such file or directory\n',
          }),
          {GITHUB_ACTIONS: 'true'},
        ),
      {
        message:
          'ssh-add -D failed (2): Error connecting to agent: No such file or directory',
      },
    );
  });

  it("tooling-118: a loosened key is readable by anyone, mode 0644 elsewhere and Everyone's read on Windows, and ssh-keygen refuses it", () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'loose-key-'));
    const file = path.join(folder, 'id_loose');
    const commands: string[] = [];
    try {
      runCommand('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file]);
      loosenKey(runCommand, file, 'linux');
      loosenKey(
        (program, programArguments) => {
          commands.push([program, ...programArguments].join(' '));
          return {
            status: program === 'ssh-keygen' ? 255 : 0,
            stdout: '',
            stderr: '',
          };
        },
        'C:\\run\\id_loose',
        'win32',
      );
      deepStrictEqual(
        [statSync(file).mode & 0o777, commands],
        [
          0o644,
          [
            'icacls C:\\run\\id_loose /grant *S-1-1-0:R',
            'ssh-keygen -y -f C:\\run\\id_loose',
          ],
        ],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('tooling-118: a loosened key that ssh-keygen still reads stops the run', () => {
    throws(
      () => {
        loosenKey(exitingWith(0), 'C:\\run\\id_loose', 'win32');
      },
      {
        message:
          'ssh-keygen still reads C:\\run\\id_loose once anyone may read it: OpenSSH would not refuse it',
      },
    );
  });

  it('tooling-118: the askpass is a shell script elsewhere and a batch file on Windows, each printing the passphrase file', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'askpass-'));
    try {
      const script = writeAskpass(folder, '/run/passphrase', 'linux');
      const batch = writeAskpass(folder, 'C:\\run\\passphrase', 'win32');
      deepStrictEqual(
        [
          path.basename(script),
          readFileSync(script, 'utf8'),
          statSync(script).mode & 0o777,
          path.basename(batch),
          readFileSync(batch, 'utf8'),
        ],
        [
          'askpass-passphrase',
          "#!/bin/sh\ncat '/run/passphrase'\n",
          0o700,
          'askpass-passphrase.cmd',
          '@type "C:\\run\\passphrase"\r\n',
        ],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('tooling-118: a key that opens with an empty passphrase stops the run, and one that needs its passphrase passes', () => {
    checkProtected(exitingWith(1), '/run/id_passphrase');
    throws(
      () => {
        checkProtected(exitingWith(0), '/run/id_passphrase');
      },
      {
        message:
          "ssh-keygen wrote /run/id_passphrase without the run's passphrase: it did not use the askpass",
      },
    );
  });

  it('tooling-29: the agent sees no variable through which it could ask', () => {
    deepStrictEqual(
      agentEnvironment({
        PATH: '/bin',
        SSH_ASKPASS: '/a',
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: ':1',
        WAYLAND_DISPLAY: 'w',
        SSH_AUTH_SOCK: '/s',
      }),
      {PATH: '/bin'},
    );
  });

  it('tooling-29: the run agent listens on its socket, starts empty and ends on stop', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'run-agent-'));
    const socket = path.join(folder, 'agent.sock');
    try {
      const agent = startRunAgent(socket);
      for (let attempt = 0; attempt < 50 && !existsSync(socket); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const listed = runProgram('ssh-add', ['-l'], {SSH_AUTH_SOCK: socket});
      await agent.stop();
      for (let attempt = 0; attempt < 50 && existsSync(socket); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      deepStrictEqual(
        [listed.status, listed.output.trim(), existsSync(socket)],
        [1, 'The agent has no identities.', false],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
