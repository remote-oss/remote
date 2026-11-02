/**
 * @fileoverview What the rows of the engine the Dev Containers view uses share: a second Docker daemon of the run, the
 * launch's Docker configuration, the engine settings in the user settings file, and the view's two outcomes.
 */

import {execFile} from 'node:child_process';
import * as network from 'node:net';
import {mkdirSync, rmSync} from 'node:fs';
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
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    const target = Object.entries(clientOf(engine))
      .map(([key, value]) => `${key}='${value}'`)
      .join(' ');
    await execFileAsync('sh', [
      '-c',
      `env -u DOCKER_HOST -u DOCKER_CONTEXT docker save '${image}' | env ${target} docker load >/dev/null`,
    ]);
    await dockerWith(clientOf(engine), 'tag', image, `${marker}:only`);
    await dockerWith(
      clientOf(engine),
      'run',
      '-d',
      '--name',
      'only',
      `${marker}:only`,
      'sleep',
      '3600',
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return {...engine, marker, container: name, stop};
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
