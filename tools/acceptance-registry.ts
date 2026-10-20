/**
 * @fileoverview The run's registry: a registry container of the run, started only for a launch that asks for one,
 * which the `cacheFrom` rows push to and import from. Nothing public is pushed, and the registry carries the run's
 * labels, so the run's clean-up and the stale sweep remove it like the run's other containers.
 */

import {DEVCONTAINER_LABEL, RUN_LABEL} from './acceptance-run.ts';
import {checked, type CommandRunner} from './command-runner.ts';

/**
 * The registry image: the tag and the digest of `registry:2.8.3` as `docker pull registry:2.8.3` reported it on
 * 2026-10-20 (`Digest: sha256:a3d8aaa6…`).
 */
export const REGISTRY_IMAGE =
  'registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373';

/** The label that marks the run's registry, so a row can find it, or start it again after a clean-up removed it. */
export const REGISTRY_LABEL = 'remote-oss.acceptance.registry';

/** How long the run waits for the registry to answer, in milliseconds. */
const READY_MILLISECONDS = 30_000;

/** How long the run waits between two asks, in milliseconds. */
const READY_INTERVAL_MILLISECONDS = 250;

/** The run's registry: its address as `host:port`, and its stop. */
export interface RunRegistry {
  address: string;
  stop(): Promise<void>;
}

/** What the wait for the registry needs of the world; the run passes the real ones. */
export interface RegistryClock {
  /** The status of `GET url`, or undefined when nothing answers. */
  status(url: string): Promise<number | undefined>;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

/** The registry's port on the host, from `docker port <container> 5000/tcp`. */
function publishedPort(command: CommandRunner, container: string): string {
  const line = checked(command, 'docker', ['port', container, '5000/tcp'])
    .split('\n')
    .map(each => each.trim())
    .find(each => each !== '');
  const port = line?.slice(line.lastIndexOf(':') + 1);
  if (port === undefined || !/^\d+$/.test(port)) {
    throw new Error(`the run's registry publishes no port: ${String(line)}`);
  }
  return port;
}

/** The `docker run` arguments of the run's registry, on the host port `hostPort` of the loopback (any when empty). */
function registryArguments(runId: string, hostPort: string): string[] {
  return [
    'run',
    '--detach',
    '--label',
    `${RUN_LABEL}=${runId}`,
    '--label',
    `${DEVCONTAINER_LABEL}=1`,
    '--label',
    `${REGISTRY_LABEL}=1`,
    '--publish',
    `127.0.0.1:${hostPort}:5000`,
    REGISTRY_IMAGE,
  ];
}

/** The containers of the run's registry, running or not, or only the running ones. */
function registryContainers(
  command: CommandRunner,
  runId: string,
  runningOnly: boolean,
): string[] {
  return checked(command, 'docker', [
    'ps',
    ...(runningOnly ? [] : ['--all']),
    '--quiet',
    '--filter',
    `label=${RUN_LABEL}=${runId}`,
    '--filter',
    `label=${REGISTRY_LABEL}=1`,
  ])
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
}

/** Removes every container of the run's registry with its anonymous volume. */
function removeRegistries(command: CommandRunner, runId: string): void {
  for (const container of registryContainers(command, runId, false)) {
    checked(command, 'docker', ['rm', '--force', '--volumes', container]);
  }
}

/** Waits until the registry at `address` answers `GET /v2/` with 200; throws, naming it, after the ready bound. */
async function answering(clock: RegistryClock, address: string): Promise<void> {
  const deadline = clock.now() + READY_MILLISECONDS;
  while ((await clock.status(`http://${address}/v2/`)) !== 200) {
    if (clock.now() > deadline) {
      throw new Error(
        `the run's registry at ${address} did not answer GET /v2/ within ${String(READY_MILLISECONDS / 1000)} s`,
      );
    }
    await clock.sleep(READY_INTERVAL_MILLISECONDS);
  }
}

/**
 * Starts the run's registry, labelled with the run, as a dev container's (so the stale sweep finds a killed run's) and
 * as the registry, waits until it answers `GET /v2/` with 200, and gives its address. Its stop removes every registry
 * container of the run, so also one a row started again.
 */
export async function startRunRegistry(
  command: CommandRunner,
  clock: RegistryClock,
  runId: string,
): Promise<RunRegistry> {
  const container = checked(
    command,
    'docker',
    registryArguments(runId, ''),
  ).trim();
  function stop(): Promise<void> {
    removeRegistries(command, runId);
    return Promise.resolve();
  }
  try {
    const address = `127.0.0.1:${publishedPort(command, container)}`;
    await answering(clock, address);
    return {address, stop};
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * Makes sure the run's registry runs at `address`: a row's clean-up removes every container of the run, the registry
 * included, so a row that needs it starts it again on the same port, empty. Gives whether it had to.
 */
export async function ensureRunRegistry(
  command: CommandRunner,
  clock: RegistryClock,
  runId: string,
  address: string,
): Promise<'running' | 'restarted'> {
  if (registryContainers(command, runId, true).length > 0) {
    return 'running';
  }
  removeRegistries(command, runId);
  checked(
    command,
    'docker',
    registryArguments(runId, address.slice(address.lastIndexOf(':') + 1)),
  );
  await answering(clock, address);
  return 'restarted';
}

/** The clock of a real run: `fetch`, the system time and a timer. */
export const SYSTEM_CLOCK: RegistryClock = {
  status: async url => {
    try {
      return (await fetch(url)).status;
    } catch {
      return undefined;
    }
  },
  now: () => Date.now(),
  sleep: milliseconds =>
    new Promise(resolve => {
      setTimeout(resolve, milliseconds);
    }),
};
