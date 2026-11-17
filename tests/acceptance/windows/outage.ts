/**
 * @fileoverview An outage of the SSH harness host and the reconnection attempts a window makes during it: the host's
 * container is paused, which stops its packets, and the log says when each attempt started and when it failed.
 */

import {execFileSync} from 'node:child_process';
import {connectionLog, variable} from './harness.ts';

/** One reconnection attempt of a window: its number in the log, when it started and when its failure was logged. */
export interface Attempt {
  number: number;
  /** Milliseconds into the day of the log's own clock when the attempt started. */
  startedAt: number;
  /** The same clock when the attempt's failure line was logged; none while it runs. */
  failedAt: number | undefined;
}

/** The lines that say a reconnection attempt failed: the shared connection's own timeout, or ssh's banner timeout. */
const FAILED = /^(connect failed: |\[ssh\] Connection timed out)/u;

/** Stops the packets of the host: its sshd stays up and answers nothing. */
export function pauseHost(): void {
  execFileSync('docker', ['pause', variable('HARNESS_CONTAINER')]);
}

/** Ends the outage; nothing happens when the host is not paused. */
export function unpauseHost(): void {
  try {
    execFileSync('docker', ['unpause', variable('HARNESS_CONTAINER')], {
      stdio: 'ignore',
    });
  } catch {
    // The host was not paused.
  }
}

/** The clock of the log, in milliseconds into the day, as a log line's own stamp reads. */
function clockOf(line: string): number | undefined {
  const match = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/u.exec(line);
  return match === null
    ? undefined
    : ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) *
        1000 +
        Number(match[4]);
}

/** The time of day now, on the clock the log's lines carry. */
export function clockNow(): number {
  const now = new Date();
  return (
    ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 +
    now.getMilliseconds()
  );
}

/** The milliseconds from `earlier` to `later`, both on the log's clock, across midnight. */
export function between(earlier: number, later: number): number {
  return (later - earlier + 86_400_000) % 86_400_000;
}

/** The reconnection attempts of host `alias` in the log after its first `mark` lines, in order. */
export function attemptsSince(mark: number, alias: string): Attempt[] {
  const start = new RegExp(
    `Resolving ssh-remote\\+${alias}, attempt (\\d+), reconnection`,
    'u',
  );
  const attempts: Attempt[] = [];
  for (const line of connectionLog({withTimes: true}).slice(mark)) {
    const stamp = clockOf(line);
    const started = start.exec(line);
    if (stamp === undefined) {
      continue;
    }
    if (started?.[1] !== undefined) {
      attempts.push({
        number: Number(started[1]),
        startedAt: stamp,
        failedAt: undefined,
      });
      continue;
    }
    const last = attempts.at(-1);
    if (
      last !== undefined &&
      last.failedAt === undefined &&
      FAILED.test(line.slice(line.indexOf('] ') + 2))
    ) {
      last.failedAt = stamp;
    }
  }
  return attempts;
}

/** A local `ssh` that carries a window's connection to the harness host: its process id and the port of its `-D` listener, when it has one. */
export interface LocalSsh {
  processId: number;
  port: number | undefined;
}

/** The `ssh` processes of this machine that run against the run's `ssh_config` for the harness host. */
export function localSshOfHarness(): LocalSsh[] {
  return execFileSync('ps', ['-eo', 'pid=,args='], {encoding: 'utf8'})
    .split('\n')
    .flatMap(line => {
      const match = /^\s*(\d+) ssh .*ssh_config .* harness( |$)/u.exec(line);
      return match?.[1] === undefined
        ? []
        : [
            {
              processId: Number(match[1]),
              port: /-D 127\.0\.0\.1:(\d+)/u.exec(line)?.[1]
                ? Number(/-D 127\.0\.0\.1:(\d+)/u.exec(line)?.[1])
                : undefined,
            },
          ];
    });
}

/** Whether process `processId` of this machine still runs. */
export function running(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
