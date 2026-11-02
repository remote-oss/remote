import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  inWindow,
  readUserSettings,
  restoreUserSettings,
  runLabelArguments,
  runScopedName,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {SECOND_ENGINE_IMAGE} from '../../../tools/acceptance-second-engine.ts';
import {rowsWhen, VIEW} from '../windows/dev-containers-view.ts';
import {welcomeText} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** An endpoint nothing listens on: the discard port refuses connections. */
const DEAD = 'tcp://127.0.0.1:9';

/** The words of the welcome content that the view shows when it reaches no engine. */
const NO_ENGINE_WORDS = 'installing Docker';

/** The Docker configuration folder of the launch, which holds the contexts the rows create. */
function dockerConfig(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'docker-config');
}

/** The output of `docker` run with `parameters`, in the launch's own Docker configuration and the extra variables. */
async function dockerWith(
  environment: Readonly<Record<string, string>>,
  ...parameters: string[]
): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters, {
    env: {...process.env, DOCKER_CONFIG: dockerConfig(), ...environment},
  });
  return stdout.trim();
}

/** A second Docker daemon of the run, in a container of its own, and the one container only it holds. */
interface SecondEngine {
  /** The `tcp://` address of the daemon on this machine. */
  address: string;
  /** The folder of the client certificates, for a daemon that requires TLS. */
  certificates: string | undefined;
  /** The repository of the image of the container only this daemon holds, as the view labels the container. */
  marker: string;
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
async function secondEngine(withTls: boolean): Promise<SecondEngine> {
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
  return {...engine, marker, stop};
}

/** Asks the view of the local window to refresh. */
async function refresh(): Promise<void> {
  await inWindow('local', 'workbench.view.remote');
  await inWindow('local', 'remote-containers.explorerTargetsRefresh').catch(
    () => undefined,
  );
}

/** Whether the view of the local window, refreshed, lists a container whose row is labelled with `marker`. */
async function lists(marker: string): Promise<boolean> {
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
async function showsNoEngine(): Promise<boolean> {
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

describe('the engine the Dev Containers view uses, from settings and contexts (card containers-133)', function () {
  this.timeout(900_000);

  let saved: string | undefined;
  let plain: SecondEngine;
  let secured: SecondEngine;

  /** Gives the user settings the bytes they had, with `change` over them and the engine settings removed first. */
  async function settingsAre(
    change: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const kept = Object.entries(
      JSON.parse(saved ?? '{}') as Record<string, unknown>,
    ).filter(([key]) => !ENGINE_SETTINGS.includes(key));
    restoreUserSettings(JSON.stringify(Object.fromEntries(kept), null, 2));
    await userSettings(change);
  }

  before(async () => {
    saved = readUserSettings();
    plain = await secondEngine(false);
    secured = await secondEngine(true);
  });

  after(async () => {
    restoreUserSettings(saved);
    await plain.stop();
    await secured.stop();
  });

  it('F-0205 AC-29 (c133-dead): a dead endpoint in only one of containers.environment, docker.environment and docker.host gives the view the welcome content of an unreachable engine, although the ambient context works', async () => {
    const shown: boolean[] = [];
    for (const change of [
      {'containers.environment': {DOCKER_HOST: DEAD}},
      {'docker.environment': {DOCKER_HOST: DEAD}},
      {'docker.host': DEAD},
    ]) {
      await settingsAre(change);
      shown.push(await showsNoEngine());
    }
    deepStrictEqual(shown, [true, true, true]);
  });

  it('F-0205 AC-31 (c133-precedence): containers.environment wins over docker.environment, which wins over docker.host; a removed one gives way to the next', async () => {
    const steps: Array<[Record<string, unknown>, boolean]> = [
      [
        {
          'containers.environment': {DOCKER_HOST: plain.address},
          'docker.environment': {DOCKER_HOST: DEAD},
          'docker.host': DEAD,
        },
        true,
      ],
      [
        {
          'containers.environment': {},
          'docker.environment': {DOCKER_HOST: plain.address},
          'docker.host': DEAD,
        },
        true,
      ],
      [
        {
          'containers.environment': {DOCKER_HOST: DEAD},
          'docker.environment': {DOCKER_HOST: plain.address},
          'docker.host': plain.address,
        },
        false,
      ],
      [{'docker.host': plain.address}, true],
    ];
    const seen: boolean[] = [];
    for (const [change] of steps) {
      await settingsAre(change);
      seen.push(await lists(plain.marker));
    }
    deepStrictEqual(
      seen,
      steps.map(([, expected]) => expected),
    );
  });

  it('F-0205 AC-33 (c133-tls): a TLS daemon is reached from docker.host with docker.certPath and docker.tlsVerify "1", and not from docker.host alone', async () => {
    await settingsAre({'docker.host': secured.address});
    const alone = await showsNoEngine();
    await settingsAre({
      'docker.host': secured.address,
      'docker.certPath': secured.certificates,
      'docker.tlsVerify': '1',
    });
    deepStrictEqual([alone, await lists(secured.marker)], [true, true]);
  });

  it('F-0205 AC-30, AC-31, AC-41 (c133-context): DOCKER_CONTEXT in containers.environment or docker.environment uses that context, a missing context gives the welcome content, a DOCKER_HOST in a lower setting wins over it, and a dead endpoint in the settings wins over a working current context', async () => {
    const context = runScopedName('c133ctx');
    await dockerWith(
      {},
      'context',
      'create',
      context,
      '--docker',
      `host=${plain.address}`,
    );
    try {
      const seen: boolean[] = [];
      await settingsAre({'containers.environment': {DOCKER_CONTEXT: context}});
      seen.push(await lists(plain.marker));
      await settingsAre({'docker.environment': {DOCKER_CONTEXT: context}});
      seen.push(await lists(plain.marker));
      await settingsAre({
        'containers.environment': {DOCKER_CONTEXT: 'c133-missing'},
      });
      seen.push(await showsNoEngine());
      await settingsAre({
        'containers.environment': {DOCKER_CONTEXT: context},
        'docker.host': DEAD,
      });
      seen.push(await showsNoEngine());
      await settingsAre({});
      await dockerWith({}, 'context', 'use', context);
      seen.push(await lists(plain.marker));
      for (const change of [
        {'containers.environment': {DOCKER_HOST: DEAD}},
        {'docker.environment': {DOCKER_HOST: DEAD}},
        {'docker.host': DEAD},
        {
          'containers.environment': {DOCKER_HOST: DEAD},
          'docker.environment': {DOCKER_CONTEXT: context},
        },
      ]) {
        await settingsAre(change);
        seen.push(await showsNoEngine());
      }
      deepStrictEqual(seen, Array<boolean>(9).fill(true));
    } finally {
      await dockerWith({}, 'context', 'use', 'default').catch(() => undefined);
      await dockerWith({}, 'context', 'rm', '--force', context).catch(
        () => undefined,
      );
    }
  });
});
