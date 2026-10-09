/**
 * @fileoverview The bounded wait for a tunnel to accept its first connection: an attempt is made at once and again
 * after each pause until one works or the bound is reached, whether or not an attempt ever ends.
 */

import type {Scheduler} from 'lib-helper';

/** How long to wait for a tunnel, and how long to pause between attempts, in milliseconds. */
export interface WaitLimits {
  readyMilliseconds: number;
  retryMilliseconds: number;
}

/** Whether `attempt` worked before the bound ran out. An attempt that throws counts as one that failed. */
export function succeedsWithin(
  attempt: () => Promise<void>,
  limits: WaitLimits,
  scheduler: Scheduler,
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let finished = false;
    let cancelPause: (() => void) | undefined;
    const cancelBound = scheduler.setTimer(limits.readyMilliseconds, () => {
      finish(false);
    });
    function finish(worked: boolean): void {
      if (finished) {
        return;
      }
      finished = true;
      cancelBound();
      cancelPause?.();
      resolve(worked);
    }
    function tryOnce(): void {
      attempt().then(
        () => {
          finish(true);
        },
        () => {
          if (!finished) {
            cancelPause = scheduler.setTimer(limits.retryMilliseconds, tryOnce);
          }
        },
      );
    }
    tryOnce();
  });
}
