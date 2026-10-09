/**
 * @fileoverview The SSH host of the server acceptance tests: the harness's Alpine `sshd` container, started for one
 * test file with a key of its own, and a host channel over `ssh` and `scp` to it. Nothing here needs the editor.
 */

import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  nodeLocalFiles,
  nodeProcessSpawner,
  parseEffectiveOptions,
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

/** The channel to `Host harness` of an ssh_config, with the options `ssh -G` computes for it. */
function channelTo(configFile: string): SshHostChannel {
  const parsed = parseEffectiveOptions(
    checked('ssh', ['-F', configFile, '-G', 'harness']),
  );
  if ('parseError' in parsed) {
    throw new Error(`ssh -G harness: ${parsed.parseError}`);
  }
  return new SshHostChannel({
    hostString: 'harness',
    platform: 'linux',
    base: {
      target: {host: 'harness'},
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
    },
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
    const channel = channelTo(configFile);
    function stop(): void {
      runCommand('docker', ['rm', '--force', container]);
      rmSync(runFolder, {recursive: true, force: true});
    }
    return {
      channel,
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
