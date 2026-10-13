/**
 * @fileoverview The host lock loop of an extension: a step that answers `LockBusy` is tried again, with a wait
 * between the attempts, until it does not or the attempts are used up.
 */

import type {HostLockLoop} from '../lifecycle/runtime.ts';
import type {StepRun} from '../lifecycle/run-step.ts';
import type {Clock} from '../locks/client-lock.ts';
import {hostLockLoop} from '../locks/host-lock-loop.ts';

/** The loop over `clock`: `attempts` tries, `intervalMilliseconds` apart, ending as `retriesExhausted` with the last busy step and the attempts made. */
export function hostLockLoopOf(
  clock: Clock,
  attempts: number,
  intervalMilliseconds: number,
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
          return {kind: 'lockBusy'};
        }
        return {kind: 'result', value: stepRun};
      },
      clock,
      () => undefined,
      attempts,
      intervalMilliseconds,
    );
    return outcome.kind === 'done'
      ? outcome.value
      : {
          kind: 'retriesExhausted',
          last: lastBusy,
          attempts: made,
        };
  };
}
