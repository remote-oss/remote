/**
 * @fileoverview One dev container launch at a time on a Docker daemon. Every dev container mounts the daemon's one
 * `vscode` volume, which a launch may remove and make again, so two runs that share a daemon take turns. The lock is a
 * network that the daemon names uniquely, labelled with the run that holds it: a create either makes it or finds it,
 * at once for every process and runner that shares the daemon. A run's own clean-up removes it with the run's
 * other networks; the lock of a local run of this host whose process has ended is removed by the next launch that
 * finds it.
 */

import {createdSecondsOf, RUN_LABEL} from './acceptance-run.ts';
import type {CommandRunner} from './command-runner.ts';

/** The lock's network: one per daemon, whoever holds it. */
export const LOCK_NETWORK = 'remote-oss-acceptance-devcontainers-lock';

/** How long a launch waits for the lock before the run gives up, in milliseconds. */
export const LOCK_WAIT_MILLISECONDS = 100 * 60_000;

/** How long a waiting launch sleeps between two tries, in milliseconds. */
const LOCK_RETRY_MILLISECONDS = 10_000;

/** How often a waiting launch says who holds the lock, in milliseconds. */
const LOCK_REPORT_MILLISECONDS = 60_000;

/** A lock a launch holds while it runs. */
export interface LaunchLock {
  take(): Promise<void>;
  release(): void;
}

/** The lock of a launch that needs none. */
export const NO_LOCK: LaunchLock = {
  take: () => Promise.resolve(),
  release: () => undefined,
};

/** The label of the lock's host: a holder named `local-<pid>` on this host can be checked by its process. */
export const HOST_LABEL = 'remote-oss.acceptance.lock-host';

/** The lock's network id, creation time (a JSON string), holder's run and host, as `docker network inspect` gives them. */
export const HOLDER_FORMAT = `{{.Id}} {{json .Created}} {{index .Labels "${RUN_LABEL}"}} {{index .Labels "${HOST_LABEL}"}}`;

/** The lock as HOLDER_FORMAT printed it. */
export interface Holder {
  networkId: string;
  createdSeconds: number | undefined;
  holderRun: string;
  holderHost: string;
}

/** The lock's holder from an `inspect` line in HOLDER_FORMAT. */
export function holderOf(line: string): Holder {
  const [networkId = '', created = '', holderRun = '', holderHost = ''] = line
    .trim()
    .split(' ');
  return {
    networkId,
    createdSeconds: createdSecondsOf(created),
    holderRun,
    holderHost,
  };
}

/** A local run's id: `local-<pid>` (CI runs are named by their job). */
const LOCAL_RUN = /^local-(\d+)$/;

/** Whether process `processId` of this host is alive (one that exists but isn't ours counts). */
export function nodeProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (caught) {
    return (caught as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Where the lock runs: the clock, this host's name, and whether a process of this host is alive. */
export interface LockWorld {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
  hostName: string;
  processAlive(processId: number): boolean;
}

/**
 * Whether the holder is a local run of this host whose process has ended: a run killed before its clean-up, whose
 * lock nothing else would remove. A CI run's clean-up step runs even after the job is cancelled.
 */
function holderGone(
  world: LockWorld,
  holderRun: string,
  holderHost: string,
): boolean {
  const local = LOCAL_RUN.exec(holderRun);
  return (
    local !== null &&
    holderHost === world.hostName &&
    !world.processAlive(Number(local[1]))
  );
}

/**
 * The daemon's dev container lock for run `runId`. `take` makes the lock's network, or waits while another run's
 * exists, saying once a minute which run holds it and for how long, and fails after LOCK_WAIT_MILLISECONDS. A create
 * that fails while no lock exists is the daemon's own failure, not a wait. The lock of a local run of this host whose
 * process has ended is removed, by its network's id, and taken. `release` removes the network this run made, by its id,
 * so it never removes another run's lock.
 */
export function daemonLock(
  command: CommandRunner,
  runId: string,
  world: LockWorld,
  report: (line: string) => void,
): LaunchLock {
  let held: string | undefined;
  return {
    async take() {
      const started = world.now();
      let reportedAt: number | undefined;
      let unreadable = 0;
      for (;;) {
        const created = command('docker', [
          'network',
          'create',
          '--label',
          `${RUN_LABEL}=${runId}`,
          '--label',
          `${HOST_LABEL}=${world.hostName}`,
          LOCK_NETWORK,
        ]);
        if (created.status === 0) {
          held = created.stdout.trim();
          return;
        }
        const holder = command('docker', [
          'network',
          'inspect',
          '--format',
          HOLDER_FORMAT,
          LOCK_NETWORK,
        ]);
        if (holder.status !== 0) {
          if (!created.stderr.includes('already exists')) {
            throw new Error(
              `docker network create ${LOCK_NETWORK}: ${created.stderr.trim()}`,
            );
          }
          // Released between the create and the inspect, the next create takes it; a lock that exists and still can't
          // be read twice in a row is the inspect's own failure, never a loop.
          unreadable += 1;
          if (unreadable > 1) {
            throw new Error(
              `docker network inspect ${LOCK_NETWORK}: ${holder.stderr.trim()}`,
            );
          }
          continue;
        }
        unreadable = 0;
        const {networkId, createdSeconds, holderRun, holderHost} = holderOf(
          holder.stdout,
        );
        if (holderGone(world, holderRun, holderHost)) {
          report(
            `acceptance: the Docker daemon's dev container lock of run ${holderRun} is left from a run that has ended; removing it`,
          );
          command('docker', ['network', 'rm', networkId]);
          continue;
        }
        const heldFor =
          createdSeconds === undefined
            ? 'an unknown time'
            : `${String(Math.round(world.now() / 1000 - createdSeconds))} s`;
        if (world.now() - started >= LOCK_WAIT_MILLISECONDS) {
          throw new Error(
            `the Docker daemon's dev container lock is still held by run ${holderRun} after ${String(LOCK_WAIT_MILLISECONDS / 60_000)} minutes (held for ${heldFor})`,
          );
        }
        if (
          reportedAt === undefined ||
          world.now() - reportedAt >= LOCK_REPORT_MILLISECONDS
        ) {
          report(
            `acceptance: waiting for the Docker daemon's dev container lock, held by run ${holderRun} for ${heldFor}`,
          );
          reportedAt = world.now();
        }
        await world.sleep(LOCK_RETRY_MILLISECONDS);
      }
    },
    release() {
      if (held !== undefined) {
        command('docker', ['network', 'rm', held]);
        held = undefined;
      }
    },
  };
}
