/**
 * @fileoverview What the rows of the engine the Dev Containers view uses share: a second Docker daemon of the run, the
 * launch's Docker configuration, the engine settings in the user settings file, and the view's two outcomes.
 */

import {execFile} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {SECOND_ENGINE_IMAGE} from '../../../tools/acceptance-second-engine.ts';
import {rowsWhen, VIEW} from '../windows/dev-containers-view.ts';
import {
  inWindow,
  restoreUserSettings,
  runLabelArguments,
  runScopedName,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {welcomeText} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** An endpoint nothing listens on: the discard port refuses connections. */
export const DEAD = 'tcp://127.0.0.1:9';

/** The words of the welcome content that the view shows when it reaches no engine. */
const NO_ENGINE_WORDS = 'installing Docker';

/** The Docker configuration folder of the launch, which holds the contexts the rows create. */
function dockerConfig(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'docker-config');
}

/** The output of `docker` run with `parameters`, in the launch's own Docker configuration and the extra variables. */
export async function dockerWith(
  environment: Readonly<Record<string, string>>,
  ...parameters: string[]
): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters, {
    env: {...process.env, DOCKER_CONFIG: dockerConfig(), ...environment},
  });
  return stdout.trim();
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
 * Starts a Docker daemon in a container of the run (the daemon of the `docker:dind` image, TLS or not), waits for it to
 * answer, and creates the container that only it holds from a copy of the run's dev container image under a repository
 * of its own.
 */
export async function secondEngine(withTls: boolean): Promise<SecondEngine> {
  const name = runScopedName(withTls ? 'c133-tls' : 'c133-plain');
  const marker = runScopedName(withTls ? 'c133tlsonly' : 'c133plainonly');
  const port = withTls ? '2376' : '2375';
  await execFileAsync('docker', [
    'run',
    '-d',
    '--rm',
    '--privileged',
    '--name',
    name,
    ...runLabelArguments(),
    '-e',
    `DOCKER_TLS_CERTDIR=${withTls ? '/certs' : ''}`,
    '-p',
    `127.0.0.1::${port}`,
    SECOND_ENGINE_IMAGE,
  ]);
  const hostPort =
    (
      (await execFileAsync('docker', ['port', name, `${port}/tcp`])).stdout
        .trim()
        .split('\n')[0] ?? ''
    )
      .split(':')
      .pop() ?? '';
  const certificates = withTls
    ? path.join(variable('HARNESS_RUN_FOLDER'), `${name}-certs`)
    : undefined;
  const engine = {address: `tcp://127.0.0.1:${hostPort}`, certificates};
  async function stop(): Promise<void> {
    await execFileAsync('docker', ['rm', '-f', name]).catch(() => undefined);
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
            await execFileAsync('docker', [
              'cp',
              `${name}:/certs/client/.`,
              certificates,
            ]);
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
      `docker save '${image}' | env ${target} docker load >/dev/null`,
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
export async function refresh(): Promise<void> {
  await inWindow('local', 'workbench.view.remote');
  await inWindow('local', 'remote-containers.explorerTargetsRefresh').catch(
    () => undefined,
  );
}

/** Whether the view of the local window, refreshed, lists a container whose row is labelled with `marker`. */
export async function lists(marker: string): Promise<boolean> {
  try {
    await refresh();
    await rowsWhen(
      'local',
      rows => rows.some(each => each.label.startsWith(marker)),
      20_000,
    );
    return true;
  } catch {
    return false;
  }
}

/** Whether the view of the local window, refreshed, shows the welcome content of an unreachable engine. */
export async function showsNoEngine(): Promise<boolean> {
  try {
    await waitFor(
      'the welcome content of an unreachable engine',
      async () => {
        await refresh();
        return ((await welcomeText('local', VIEW)) ?? '').includes(
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
