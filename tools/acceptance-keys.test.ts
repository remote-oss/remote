import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  agentEnvironment,
  agentSocketPath,
  controlFolderOf,
  SOCKET_PATH_LIMIT,
  CERTIFIED_PRINCIPAL,
  makeRunKeys,
  PASSPHRASE_KEY_COMMENT,
  type RunKeys,
  startRunAgent,
} from './acceptance-keys.ts';
import {type CommandRunner, runCommand} from './acceptance-run.ts';

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

  it('tooling-29: the host is given the passphrase and second public keys, and the authority', () => {
    deepStrictEqual(keys.hostArguments, [
      '--env',
      `AUTHORIZED_KEYS_FURTHER=${publicKeyOf(keys.passphraseKey)}\n${publicKeyOf(keys.secondKey)}`,
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
      agent.stop();
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
