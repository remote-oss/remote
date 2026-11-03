/**
 * @fileoverview What the rows of the engine the Dev Containers view uses share: a second Docker daemon of the run, the
 * launch's Docker configuration, the engine settings in the user settings file, and the view's two outcomes.
 */

import {execFile} from 'node:child_process';
import * as network from 'node:net';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {SECOND_ENGINE_IMAGE} from '../../../tools/acceptance-second-engine.ts';
import {rowsWhen, VIEW} from './dev-containers-view.ts';
import {
  inWindow,
  restoreUserSettings,
  runLabelArguments,
  runScopedName,
  userSettings,
  variable,
  waitFor,
} from './harness.ts';
import {rowDetails, welcomeText} from './renderer.ts';

const execFileAsync = promisify(execFile);

/** An endpoint nothing listens on: the discard port refuses connections. */
export const DEAD = 'tcp://127.0.0.1:9';

/** The words of the welcome content that the view shows when it reaches no engine. */
const NO_ENGINE_WORDS = 'installing Docker';

/** The Docker configuration folder of the launch, which holds the contexts the rows create. */
function dockerConfig(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'docker-config');
}

/** The variables with which the editor of a launch may start and which pick an engine. */
const ENGINE_VARIABLE_NAMES = [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
];

/** This process's environment without the variables that pick an engine, which a launch may have set for its editor. */
function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !ENGINE_VARIABLE_NAMES.includes(name),
    ),
  );
}

/** The output of `docker` run with `parameters`, in the launch's own Docker configuration and the extra variables. */
export async function dockerWith(
  environment: Readonly<Record<string, string>>,
  ...parameters: string[]
): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters, {
    env: {...cleanEnvironment(), DOCKER_CONFIG: dockerConfig(), ...environment},
  });
  return stdout.trim();
}

/** The output of `docker` run with `parameters` on this machine's own daemon, whatever context the launch has made current. */
function localDocker(...parameters: string[]): Promise<string> {
  return dockerWith({}, '--context', 'default', ...parameters);
}

/** A second Docker daemon of the run, in a container of its own, and the one container only it holds. */
export interface SecondEngine {
  /** The `tcp://` address of the daemon on this machine. */
  address: string;
  /** The folder of the client certificates, for a daemon that requires TLS. */
  certificates: string | undefined;
  /** The repository of the image of the container only this daemon holds, as the view labels the container. */
  marker: string;
  /** The name of the container that runs the daemon. */
  container: string;
  stop(): Promise<void>;
}

/** The environment of a `docker` that talks to `engine`. */
function clientOf(engine: {
  address: string;
  certificates?: string | undefined;
}): Record<string, string> {
  return {
    DOCKER_HOST: engine.address,
    ...(engine.certificates === undefined
      ? {}
      : {DOCKER_CERT_PATH: engine.certificates, DOCKER_TLS_VERIFY: '1'}),
  };
}

/**
 * Gives the daemon that `client` reaches a copy of the run's dev container image under the repository `marker`, and
 * runs the one container that only this daemon holds from it.
 */
async function holdMarker(
  client: Readonly<Record<string, string>>,
  marker: string,
): Promise<void> {
  const image = variable('HARNESS_DEVCONTAINER_IMAGE');
  const target = Object.entries(client)
    .map(([key, value]) => `${key}='${value}'`)
    .join(' ');
  await execFileAsync('sh', [
    '-c',
    `env -u DOCKER_HOST -u DOCKER_CONTEXT docker save '${image}' | env ${target} docker load >/dev/null`,
  ]);
  await dockerWith(client, 'tag', image, `${marker}:only`);
  await dockerWith(
    client,
    'run',
    '-d',
    '--name',
    'only',
    `${marker}:only`,
    'sleep',
    '3600',
  );
}

/** How many daemons this process has started, so that each one's names are its own. */
let started = 0;

/**
 * Starts a Docker daemon in a container of the run (the daemon of the `docker:dind` image, TLS or not), waits for it to
 * answer, and creates the container that only it holds from a copy of the run's dev container image under a repository
 * of its own. A `hostPort` fixes the port the daemon is published on. A `shared` folder is mounted into the daemon's container at the same path, so that a dev container the daemon
 * makes can bind a folder opened from there (the daemon's own /tmp is hidden by the image).
 */
export async function secondEngine(
  options: {secured?: boolean; shared?: string; hostPort?: number} = {},
): Promise<SecondEngine> {
  const withTls = options.secured === true;
  const {shared} = options;
  started += 1;
  const kind = `${withTls ? 'tls' : 'plain'}${String(started)}`;
  const name = runScopedName(`c133-${kind}`);
  const marker = runScopedName(`c133${kind}only`);
  const port = withTls ? '2376' : '2375';
  await localDocker(
    'run',
    '-d',
    '--rm',
    '--privileged',
    '--name',
    name,
    ...runLabelArguments(),
    '-e',
    `DOCKER_TLS_CERTDIR=${withTls ? '/certs' : ''}`,
    ...(shared === undefined ? [] : ['-v', `${shared}:${shared}`]),
    '-p',
    `127.0.0.1:${options.hostPort === undefined ? '' : String(options.hostPort)}:${port}`,
    SECOND_ENGINE_IMAGE,
  );
  const hostPort =
    ((await localDocker('port', name, `${port}/tcp`)).split('\n')[0] ?? '')
      .split(':')
      .pop() ?? '';
  const certificates = withTls
    ? path.join(variable('HARNESS_RUN_FOLDER'), `${name}-certs`)
    : undefined;
  const engine = {address: `tcp://127.0.0.1:${hostPort}`, certificates};
  async function stop(): Promise<void> {
    await localDocker('rm', '-f', name).catch(() => undefined);
    if (certificates !== undefined) {
      rmSync(certificates, {recursive: true, force: true});
    }
  }
  try {
    await waitFor(
      `the daemon in ${name}`,
      async () => {
        try {
          if (certificates !== undefined) {
            mkdirSync(certificates, {recursive: true});
            await localDocker('cp', `${name}:/certs/client/.`, certificates);
          }
          await dockerWith(clientOf(engine), 'info');
          return true;
        } catch {
          return false;
        }
      },
      120_000,
    );
    await holdMarker(clientOf(engine), marker);
  } catch (error) {
    await stop();
    throw error;
  }
  return {...engine, marker, container: name, stop};
}

/** The image of the SSH Docker host, built from `tests/acceptance/ssh-engine` on the pinned second engine image. */
const SSH_ENGINE_IMAGE = 'remote-oss-acceptance-ssh-engine:1';

/** The accounts of the SSH Docker host, each logging in one way (`tests/acceptance/ssh-engine/Dockerfile`). */
export type EngineAccount =
  | 'engine'
  | 'engine-pw'
  | 'engine-pw2'
  | 'engine-enc'
  | 'engine-refused'
  | 'engine-tries';

/** The run's key files each account's client offers, from the run's folder; none for the password accounts. */
const ACCOUNT_KEYS: Readonly<Record<EngineAccount, readonly string[]>> = {
  engine: ['id_ed25519'],
  'engine-pw': [],
  'engine-pw2': [],
  'engine-enc': ['id_passphrase'],
  'engine-refused': ['id_ed25519'],
  'engine-tries': [
    'id_ed25519',
    'id_second',
    'id_unauthorised',
    'id_noportfwd',
  ],
};

/** The folder of the run's SSH client for the engine: its `ssh_config`, its known hosts file and the wrapper's folder. */
function sshClientFolder(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'ssh-engine');
}

/** The folder that `containers-ssh-engine` puts first on its editor's `PATH`: an `ssh` that reads the run's own `ssh_config`. */
export function sshWrapperFolder(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'ssh-engine-bin');
}

/** The folder that is the whole `PATH` of `containers-ssh-noclient`'s editor: `docker` and nothing else. */
export function dockerOnlyFolder(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'docker-only-bin');
}

/** The known hosts file the run's SSH client reads for the engine. */
export function engineKnownHosts(): string {
  return path.join(sshClientFolder(), 'known_hosts');
}

/** The environment of a `docker` of this process that reaches an engine over SSH through the run's own client. */
export function sshClientEnvironment(): Record<string, string> {
  return {PATH: `${sshWrapperFolder()}:${process.env.PATH ?? ''}`};
}

/** Where `program` is on this process's `PATH`, outside the run's own folders. */
async function realProgram(program: string): Promise<string> {
  const {stdout} = await execFileAsync('sh', ['-c', `command -v ${program}`]);
  return stdout.trim();
}

/**
 * Writes the run's SSH client for the engine, once: an `ssh_config` that names each account's key and the run's known
 * hosts file, with no agent, so that the run never reads the account's real `~/.ssh` (OpenSSH takes it from the password
 * database, not `HOME`); an `ssh` wrapper that runs the real one with that file; and the folder with `docker` alone.
 */
export async function writeSshClient(): Promise<void> {
  const folder = sshClientFolder();
  if (existsSync(path.join(folder, 'ssh_config'))) {
    return;
  }
  mkdirSync(folder, {recursive: true});
  const runFolder = variable('HARNESS_RUN_FOLDER');
  writeFileSync(engineKnownHosts(), '');
  writeFileSync(
    path.join(folder, 'ssh_config'),
    [
      'Host 127.0.0.1',
      `  UserKnownHostsFile ${engineKnownHosts()}`,
      '  StrictHostKeyChecking ask',
      '  IdentitiesOnly yes',
      '  IdentityAgent none',
      ...Object.entries(ACCOUNT_KEYS).flatMap(([account, keys]) =>
        keys.length === 0
          ? []
          : [
              `Match user ${account}`,
              ...keys.map(key => `  IdentityFile ${path.join(runFolder, key)}`),
            ],
      ),
      '',
    ].join('\n'),
  );
  const realSsh = await realProgram('ssh');
  mkdirSync(sshWrapperFolder(), {recursive: true});
  const wrapper = path.join(sshWrapperFolder(), 'ssh');
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec '${realSsh}' -F '${path.join(folder, 'ssh_config')}' "$@"\n`,
  );
  chmodSync(wrapper, 0o755);
  mkdirSync(dockerOnlyFolder(), {recursive: true});
  symlinkSync(
    await realProgram('docker'),
    path.join(dockerOnlyFolder(), 'docker'),
  );
}

/** An SSH Docker host of the run: a daemon in a container of its own, reached as `ssh://`, and the one container only it holds. */
export interface SshEngine {
  /** The `ssh://` address of the daemon for `account`. */
  address(account: EngineAccount): string;
  /** The repository of the image of the container only this daemon holds, as the view labels the container. */
  marker: string;
  /** The line of the run's known hosts file that makes the host's key known. */
  knownHostsLine: string;
  /** Makes the host's key known to the run's client, or unknown again. */
  trustHostKey(known: boolean): void;
  /** The name of the container that runs the daemon and sshd. */
  container: string;
  stop(): Promise<void>;
}

/** Builds the SSH Docker host's image once per process; a later build of an unchanged folder is Docker's cache. */
let imageBuilt: Promise<string> | undefined;

/**
 * Starts an SSH Docker host of the run: the second engine's daemon with OpenSSH's server, in a privileged container of
 * the run, sshd published on 127.0.0.1. Its accounts are `ACCOUNT_KEYS`'s, `engine-pw` and `engine-pw2` with the
 * passwords given. It waits until `docker -H ssh://engine@…` answers through the run's client with the host's key
 * known, and creates the container only it holds. A `shared` folder is mounted at the same path, as for `secondEngine`.
 */
export async function sshEngine(
  options: {password?: string; password2?: string; shared?: string} = {},
): Promise<SshEngine> {
  await writeSshClient();
  imageBuilt ??= localDocker(
    'build',
    '--quiet',
    '--build-arg',
    `ENGINE_IMAGE=${SECOND_ENGINE_IMAGE}`,
    '--tag',
    SSH_ENGINE_IMAGE,
    path.join(import.meta.dirname, '..', 'ssh-engine'),
  );
  await imageBuilt;
  started += 1;
  const name = runScopedName(`c205-ssh${String(started)}`);
  const marker = runScopedName(`c205ssh${String(started)}only`);
  const runFolder = variable('HARNESS_RUN_FOLDER');
  /** The public part of the run's key `file`. */
  function keyOf(file: string): string {
    return readFileSync(path.join(runFolder, `${file}.pub`), 'utf8').trim();
  }
  await localDocker(
    'run',
    '-d',
    '--rm',
    '--privileged',
    '--name',
    name,
    ...runLabelArguments(),
    '-e',
    'DOCKER_TLS_CERTDIR=',
    '-e',
    `ENGINE_KEY=${keyOf('id_ed25519')}`,
    '-e',
    `ENGINE_ENC_KEY=${keyOf('id_passphrase')}`,
    '-e',
    `ENGINE_PASSWORD=${options.password ?? 'engine-password'}`,
    '-e',
    `ENGINE_PASSWORD_2=${options.password2 ?? 'engine-password-2'}`,
    ...(options.shared === undefined
      ? []
      : ['-v', `${options.shared}:${options.shared}`]),
    '-p',
    '127.0.0.1::22',
    SSH_ENGINE_IMAGE,
  );
  async function stop(): Promise<void> {
    await localDocker('rm', '-f', name).catch(() => undefined);
  }
  try {
    const port =
      ((await localDocker('port', name, '22/tcp')).split('\n')[0] ?? '')
        .split(':')
        .pop() ?? '';
    /** The `ssh://` address of the daemon for `account`. */
    function address(account: EngineAccount): string {
      return `ssh://${account}@127.0.0.1:${port}`;
    }
    let knownHostsLine = '';
    await waitFor(
      `sshd in ${name}`,
      async () => {
        const key = await localDocker(
          'exec',
          name,
          'cat',
          '/etc/ssh/ssh_host_ed25519_key.pub',
        ).catch(() => '');
        knownHostsLine = `[127.0.0.1]:${port} ${key.split(' ').slice(0, 2).join(' ')}`;
        return key !== '';
      },
      60_000,
    );
    /** Makes the host's key known to the run's client, or unknown again. */
    function trustHostKey(known: boolean): void {
      const others = readFileSync(engineKnownHosts(), 'utf8')
        .split('\n')
        .filter(line => line !== '' && line !== knownHostsLine);
      writeFileSync(
        engineKnownHosts(),
        [...others, ...(known ? [knownHostsLine] : []), ''].join('\n'),
      );
    }
    trustHostKey(true);
    const client = {...sshClientEnvironment(), DOCKER_HOST: address('engine')};
    await waitFor(
      `the daemon in ${name} over SSH`,
      async () => {
        try {
          await dockerWith(client, 'info');
          return true;
        } catch {
          return false;
        }
      },
      120_000,
    );
    await holdMarker(client, marker);
    return {
      address,
      marker,
      knownHostsLine,
      trustHostKey,
      container: name,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Asks the view of the local window to refresh. */
export async function refresh(window = 'local'): Promise<void> {
  await inWindow(window, 'workbench.view.remote');
  await inWindow(window, 'remote-containers.explorerTargetsRefresh').catch(
    () => undefined,
  );
}

/** Whether the view of window `window`, refreshed, lists a container whose row is labelled with `marker`. */
export async function lists(
  marker: string,
  window = 'local',
): Promise<boolean> {
  try {
    await refresh(window);
    await rowsWhen(
      window,
      rows => rows.some(each => each.label.startsWith(marker)),
      20_000,
    );
    return true;
  } catch {
    return false;
  }
}

/** Whether the view of window `window`, refreshed, shows the welcome content of an unreachable engine. */
export async function showsNoEngine(window = 'local'): Promise<boolean> {
  try {
    await waitFor(
      'the welcome content of an unreachable engine',
      async () => {
        await refresh(window);
        return ((await welcomeText(window, VIEW)) ?? '').includes(
          NO_ENGINE_WORDS,
        );
      },
      20_000,
    );
    return true;
  } catch {
    return false;
  }
}

/** The engine settings the rows write, all removed. */
const ENGINE_SETTINGS = [
  'containers.environment',
  'docker.environment',
  'docker.host',
  'docker.certPath',
  'docker.tlsVerify',
];

/** Gives the user settings the bytes `saved` holds, with the engine settings removed and `change` over them. */
export async function engineSettingsAre(
  saved: string | undefined,
  change: Readonly<Record<string, unknown>>,
): Promise<void> {
  const kept = Object.entries(
    JSON.parse(saved ?? '{}') as Record<string, unknown>,
  ).filter(([key]) => !ENGINE_SETTINGS.includes(key));
  restoreUserSettings(JSON.stringify(Object.fromEntries(kept), null, 2));
  await userSettings(change);
}

/** A `tcp://` address on this machine that passes every connection on to the local Docker socket. */
export interface SocketProxy {
  address: string;
  close(): Promise<void>;
}

/** Listens on a free port of 127.0.0.1 and relays each connection to the local Docker socket. */
export async function socketProxy(): Promise<SocketProxy> {
  const socket = (
    process.env.DOCKER_HOST ?? 'unix:///var/run/docker.sock'
  ).replace(/^unix:\/\//, '');
  const connections = new Set<network.Socket>();
  const server = network.createServer({allowHalfOpen: true}, client => {
    const engine = network.connect({path: socket, allowHalfOpen: true});
    for (const each of [client, engine]) {
      connections.add(each);
      each.on('close', () => connections.delete(each));
      each.on('error', () => each.destroy());
    }
    client.pipe(engine).pipe(client);
  });
  await new Promise<void>(resolve =>
    server.listen(0, '127.0.0.1', () => {
      resolve();
    }),
  );
  const {port} = server.address() as network.AddressInfo;
  return {
    address: `tcp://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>(resolve => {
        for (const each of connections) {
          each.destroy();
        }
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * The labels of the rows the view of the local window shows after a refresh, or none when it shows the welcome content
 * of an unreachable engine. A row listing waits a moment, so that the rows of one engine are all there.
 */
export async function viewLabels(): Promise<string[] | undefined> {
  await refresh();
  let labels: string[] | undefined;
  await waitFor(
    'the rows or the welcome content of the view',
    async () => {
      const rows = (await rowDetails('local', VIEW).catch(() => [])) ?? [];
      if (rows.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        labels = ((await rowDetails('local', VIEW)) ?? []).map(
          each => each.label,
        );
        return true;
      }
      return ((await welcomeText('local', VIEW)) ?? '').includes(
        NO_ENGINE_WORDS,
      );
    },
    30_000,
  );
  return labels;
}
