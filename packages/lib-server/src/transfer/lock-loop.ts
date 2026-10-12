/**
 * @fileoverview The host lock loop of an extension: a step that answers `LockBusy` is tried again, with a wait
 * between the attempts, until it does not or the attempts are used up.
 */

import type {HostLockLoop} from '../lifecycle/runtime.ts';
import type {StepRun} from '../lifecycle/run-step.ts';
import type {Clock} from '../locks/client-lock.ts';
import {hostLockLoop} from '../locks/host-lock-loop.ts';

/** The loop over `clock`: `attempts` tries, `intervalMilliseconds` apart, ending as `retriesExhausted`. */
export function hostLockLoopOf(
  clock: Clock,
  attempts: number,
  intervalMilliseconds: number,
): HostLockLoop {
  return async step => {
    const outcome = await hostLockLoop<StepRun>(
      async () => {
        const stepRun = await step();
        return stepRun.kind === 'result' && stepRun.block.status === 'LockBusy'
          ? {kind: 'lockBusy'}
          : {kind: 'result', value: stepRun};
      },
      clock,
      () => undefined,
      attempts,
      intervalMilliseconds,
    );
    return outcome.kind === 'done' ? outcome.value : 'retriesExhausted';
  };
}
