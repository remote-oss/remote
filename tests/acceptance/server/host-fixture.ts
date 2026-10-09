/**
 * @fileoverview The SSH host of the server acceptance tests: the harness's Alpine `sshd` container, started for one
 * test file with a key of its own, and a host channel over `ssh` and `scp` to it. Nothing here needs the editor.
 */

import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  nodeLocalFiles,
  nodeProcessSpawner,
  parseEffectiveOptions,
  type RunBase,
  SshHostChannel,
} from 'lib-ssh';
import {
  harnessSshConfig,
  HOST_IMAGE,
  mappedPort,
  runCommand,
} from '../../../tools/acceptance.ts';

const REPOSITORY_ROOT = path.join(import.meta.dirname, '..', '..', '..');

/** How often and how long the fixture waits for the host to accept SSH. */
const READY_ATTEMPTS = 40;
const READY_INTERVAL_MILLISECONDS = 500;

/** A running host and what a test does with it. */
export interface RunningHost {
  /** The channel the library under test uses. */
  channel: SshHostChannel;
  /** What every `ssh` run to the host shares: the target, the settings and the options `ssh -G` computes. */
  base: RunBase;
  /** The same for another `Host` of the run's ssh_config, such as one added with `appendConfig`. */
  baseOf(alias: string): RunBase;
  /** Adds text to the run's ssh_config. */
  appendConfig(text: string): void;
  /** Makes an Ed25519 key pair at `keyFile`, its private key protected by `passphrase`. */
  generateKey(keyFile: string, passphrase: string): void;
  /** Lets the user `harness` log in with the public key in the local file. */
  authorize(publicKeyFile: string): void;
  /** The port on this machine that reaches the host's `sshd`. */
  port: number;
  /** The run's folder: its keys and known hosts. */
  runFolder: string;
  /** How many logins the host's `sshd` has accepted since it started. */
  logins(): number;
  /** The output of a command run in the container as the user harness, outside SSH. */
  onHost(...command: string[]): string;
  /** The output of a command run in the container as root, to change the host before a test. */
  asRoot(...command: string[]): string;
  /** Copies a local file into the container, owned by the user harness. */
  copyIn(localFile: string, hostFile: string): void;
  /** Removes the container and the run's folder. */
  stop(): void;
}

function checked(program: string, programArguments: readonly string[]): string {
  const result = runCommand(program, programArguments);
  if (result.status !== 0) {
    throw new Error(
      `${program} ${programArguments.join(' ')} failed (${String(result.status)}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

async function waitForHost(configFile: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const result = runCommand('ssh', ['-F', configFile, 'harness', 'true']);
    if (result.status === 0) {
      return;
    }
    if (attempt === READY_ATTEMPTS) {
      throw new Error(`the host did not accept SSH: ${result.stderr.trim()}`);
    }
    await new Promise(resolve =>
      setTimeout(resolve, READY_INTERVAL_MILLISECONDS),
    );
  }
}

/** What every run to a `Host` of an ssh_config shares, with the options `ssh -G` computes for it. */
function baseFor(configFile: string, alias: string): RunBase {
  const parsed = parseEffectiveOptions(
    checked('ssh', ['-F', configFile, '-G', alias]),
  );
  if ('parseError' in parsed) {
    throw new Error(`ssh -G ${alias}: ${parsed.parseError}`);
  }
  return {
    target: {host: alias},
    settings: {
      configFile,
      connectTimeout: 10,
      permitPtyAllocation: false,
      remoteCommandInEffect: false,
    },
    effective: parsed.options,
    programs: {sshProgram: 'ssh', scpProgram: 'scp'},
    homeFolder: tmpdir(),
    platform: process.platform === 'win32' ? 'windows' : 'linux',
  };
}

/** The channel to `Host harness` over the `ssh` and `scp` clients. */
function channelTo(base: RunBase): SshHostChannel {
  return new SshHostChannel({
    hostString: 'harness',
    platform: 'linux',
    base,
    spawner: nodeProcessSpawner,
    editorEnvironment: process.env,
    askpassEnvironment: {},
    files: nodeLocalFiles,
    scheduler: {
      setTimer: (milliseconds, callback) => {
        const timer = setTimeout(callback, milliseconds);
        return () => {
          clearTimeout(timer);
        };
      },
    },
    timeoutMilliseconds: 60000,
  });
}

/** Starts the host and waits until it accepts SSH; call `stop` when the tests are done, also after a failure. */
export async function startHost(): Promise<RunningHost> {
  const runFolder = mkdtempSync(path.join(tmpdir(), 'server-acceptance-'));
  let container = '';
  try {
    checked('docker', [
      'build',
      '--load',
      '--quiet',
      '--tag',
      HOST_IMAGE,
      path.join(REPOSITORY_ROOT, 'tests', 'acceptance', 'host'),
    ]);
    const keyFile = path.join(runFolder, 'id_ed25519');
    checked('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      'acceptance',
      '-f',
      keyFile,
    ]);
    const publicKey = readFileSync(`${keyFile}.pub`, 'utf8').trim();
    container = checked('docker', [
      'run',
      '--detach',
      '--rm',
      '--env',
      `AUTHORIZED_KEY=${publicKey}`,
      '--publish',
      '127.0.0.1::22',
      HOST_IMAGE,
    ]).trim();
    const port = mappedPort(checked('docker', ['port', container, '22']));
    const configFile = path.join(runFolder, 'ssh_config');
    writeFileSync(configFile, harnessSshConfig(port, runFolder));
    await waitForHost(configFile);
    const base = baseFor(configFile, 'harness');
    const channel = channelTo(base);
    function stop(): void {
      runCommand('docker', ['rm', '--force', container]);
      rmSync(runFolder, {recursive: true, force: true});
    }
    return {
      channel,
      base,
      baseOf: alias => baseFor(configFile, alias),
      appendConfig: text => {
        appendFileSync(configFile, text);
      },
      port,
      runFolder,
      generateKey: (keyFile, passphrase) => {
        checked('ssh-keygen', [
          '-q',
          '-t',
          'ed25519',
          '-N',
          passphrase,
          '-f',
          keyFile,
        ]);
      },
      authorize: publicKeyFile => {
        const key = readFileSync(publicKeyFile, 'utf8').trim();
        checked('docker', [
          'exec',
          '--user',
          'harness',
          container,
          'sh',
          '-c',
          `printf '%s\\n' '${key}' >> /home/harness/.ssh/authorized_keys`,
        ]);
      },
      logins: () => {
        const output = runCommand('docker', ['logs', container]);
        return (
          `${output.stdout}${output.stderr}`.split('Accepted publickey')
            .length - 1
        );
      },
      onHost: (...command) =>
        checked('docker', ['exec', '--user', 'harness', container, ...command]),
      asRoot: (...command) =>
        checked('docker', ['exec', '--user', 'root', container, ...command]),
      copyIn: (localFile, hostFile) => {
        checked('docker', ['cp', localFile, `${container}:${hostFile}`]);
        checked('docker', [
          'exec',
          '--user',
          'root',
          container,
          'chown',
          'harness:harness',
          hostFile,
        ]);
      },
      stop,
    };
  } catch (error) {
    if (container !== '') {
      runCommand('docker', ['rm', '--force', container]);
    }
    rmSync(runFolder, {recursive: true, force: true});
    throw error;
  }
}
