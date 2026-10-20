/**
 * @fileoverview The host lock loop of an extension: a step that answers `LockBusy` is tried again, with a wait
 * between the attempts, until it does not or the attempts are used up; each wait, and a lock taken after waiting, is
 * reported to the caller.
 */

import type {HostLockLoop} from '../lifecycle/runtime.ts';
import type {StepRun} from '../lifecycle/run-step.ts';
import type {Clock} from '../locks/client-lock.ts';
import {hostLockLoop} from '../locks/host-lock-loop.ts';

/** What the loop reports: an attempt that found the lock held by another, and a lock taken after such waits. */
export type LockWait =
  | {kind: 'busy'; attempt: number; attempts: number; lockPath?: string}
  | {kind: 'taken'; attempts: number; lockPath?: string};

/** The lock path a busy step's script named, when it named one. */
function lockPathOf(stepRun: StepRun): {lockPath?: string} {
  const lockPath =
    stepRun.kind === 'result' ? stepRun.block.serverFacts.lockPath : undefined;
  return lockPath === undefined ? {} : {lockPath};
}

/**
 * The loop over `clock`: `attempts` tries, `intervalMilliseconds` apart, ending as `retriesExhausted` with the last busy
 * step and the attempts made. `onWait` hears each busy attempt, and the attempt that took the lock after a wait.
 */
export function hostLockLoopOf(
  clock: Clock,
  attempts: number,
  intervalMilliseconds: number,
  onWait: (wait: LockWait) => void = () => undefined,
): HostLockLoop {
  return async step => {
    let made = 0;
    let lastBusy: StepRun = {kind: 'noResultBlock', exitStatus: 0};
    const outcome = await hostLockLoop<StepRun>(
      async () => {
        made += 1;
        const stepRun = await step();
        if (stepRun.kind === 'result' && stepRun.block.status === 'LockBusy') {
          lastBusy = stepRun;
          onWait({
            kind: 'busy',
            attempt: made,
            attempts,
            ...lockPathOf(stepRun),
          });
          return {kind: 'lockBusy'};
        }
        return {kind: 'result', value: stepRun};
      },
      clock,
      () => undefined,
      attempts,
      intervalMilliseconds,
    );
    if (outcome.kind === 'done') {
      if (made > 1) {
        onWait({kind: 'taken', attempts: made, ...lockPathOf(lastBusy)});
      }
      return outcome.value;
    }
    return {
      kind: 'retriesExhausted',
      last: lastBusy,
      attempts: made,
    };
  };
}
