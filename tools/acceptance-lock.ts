/**
 * @fileoverview One dev container launch at a time on a Docker daemon. Every dev container mounts the daemon's one
 * `vscode` volume, which a launch may remove and make again, so two runs that share a daemon take turns. The lock is a
 * network that the daemon names uniquely, labelled with the run that holds it: a create either makes it or finds it,
 * at once for every process and runner that shares the daemon. A run's own clean-up removes it with the run's
 * other networks, and the sweep of empty run networks older than two hours removes one that a killed run left.
 */

import {RUN_LABEL} from './acceptance-run.ts';
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

/** What the wait needs of the world; the run passes the real clock. */
export interface LockClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

/** The holder's run and the lock's creation time in seconds, as `docker network inspect` gives them. */
const HOLDER_FORMAT = `{{index .Labels "${RUN_LABEL}"}} {{.Created.Unix}}`;

/**
 * The daemon's dev container lock for run `runId`. `take` makes the lock's network, or waits while another run's
 * exists, saying once a minute which run holds it and for how long, and fails after LOCK_WAIT_MILLISECONDS. A create
 * that fails while no lock exists is the daemon's own failure, not a wait. `release` removes the network.
 */
export function daemonLock(
  command: CommandRunner,
  runId: string,
  clock: LockClock,
  report: (line: string) => void,
): LaunchLock {
  return {
    async take() {
      const started = clock.now();
      let reportedAt: number | undefined;
      for (;;) {
        const created = command('docker', [
          'network',
          'create',
          '--label',
          `${RUN_LABEL}=${runId}`,
          LOCK_NETWORK,
        ]);
        if (created.status === 0) {
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
          if (created.stderr.includes('already exists')) {
            // Released between the create and the inspect: the next create takes it.
            continue;
          }
          throw new Error(
            `docker network create ${LOCK_NETWORK}: ${created.stderr.trim()}`,
          );
        }
        const [holderRun = '', createdSeconds = '0'] = holder.stdout
          .trim()
          .split(' ');
        const heldFor = `${String(Math.round(clock.now() / 1000 - Number(createdSeconds)))} s`;
        if (clock.now() - started >= LOCK_WAIT_MILLISECONDS) {
          throw new Error(
            `the Docker daemon's dev container lock is still held by run ${holderRun} after ${String(LOCK_WAIT_MILLISECONDS / 60_000)} minutes (held for ${heldFor})`,
          );
        }
        if (
          reportedAt === undefined ||
          clock.now() - reportedAt >= LOCK_REPORT_MILLISECONDS
        ) {
          report(
            `acceptance: waiting for the Docker daemon's dev container lock, held by run ${holderRun} for ${heldFor}`,
          );
          reportedAt = clock.now();
        }
        await clock.sleep(LOCK_RETRY_MILLISECONDS);
      }
    },
    release() {
      command('docker', ['network', 'rm', LOCK_NETWORK]);
    },
  };
}
