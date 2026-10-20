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

/**
 * Starts the run's registry, labelled with the run and as a dev container's (so the stale sweep finds a killed run's),
 * waits until it answers `GET /v2/` with 200, and gives its address.
 */
export async function startRunRegistry(
  command: CommandRunner,
  clock: RegistryClock,
  runId: string,
): Promise<RunRegistry> {
  const container = checked(command, 'docker', [
    'run',
    '--detach',
    '--label',
    `${RUN_LABEL}=${runId}`,
    '--label',
    `${DEVCONTAINER_LABEL}=1`,
    '--publish',
    '127.0.0.1::5000',
    REGISTRY_IMAGE,
  ]).trim();
  function stop(): Promise<void> {
    checked(command, 'docker', ['rm', '--force', '--volumes', container]);
    return Promise.resolve();
  }
  try {
    const address = `127.0.0.1:${publishedPort(command, container)}`;
    const deadline = clock.now() + READY_MILLISECONDS;
    while ((await clock.status(`http://${address}/v2/`)) !== 200) {
      if (clock.now() > deadline) {
        throw new Error(
          `the run's registry at ${address} did not answer GET /v2/ within ${String(READY_MILLISECONDS / 1000)} s`,
        );
      }
      await clock.sleep(READY_INTERVAL_MILLISECONDS);
    }
    return {address, stop};
  } catch (error) {
    await stop();
    throw error;
  }
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
