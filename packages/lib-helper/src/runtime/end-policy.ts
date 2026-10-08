/**
 * @fileoverview Ends a helper by its policy once its last lease has closed, unless a lease opens in time.
 */

import type {EndPolicy} from '../types.ts';
import type {LeaseTable} from './leases.ts';

/** Arms timers; the returned function cancels one. */
export interface Scheduler {
  setTimer(milliseconds: number, callback: () => void): () => void;
}

/** What the helper does when its policy's time is up. */
export type PolicyOutcome =
  {kind: 'end'} | {kind: 'runActionThenEnd'; action: string};

/** A policy the runner cannot apply. */
export class PolicyError extends Error {
  /** An error naming the policy's problem. */
  constructor(problem: string) {
    super(`end policy: ${problem}`);
    this.name = 'PolicyError';
  }
}

/**
 * Watches the lease table: when the live list becomes empty it arms one timer for the policy's time, and a lease
 * that opens before the timer fires disarms it. A helper starts with its first lease pending, so an empty table at
 * construction arms nothing.
 */
export class EndPolicyRunner {
  private readonly policy: EndPolicy;
  private readonly table: LeaseTable;
  private readonly scheduler: Scheduler;
  private readonly onOutcome: (outcome: PolicyOutcome) => void;
  private readonly unsubscribe: () => void;
  private cancelTimer: (() => void) | undefined;

  /** Starts watching `table`; throws PolicyError for a time that is not a positive finite number. */
  constructor(
    policy: EndPolicy,
    table: LeaseTable,
    scheduler: Scheduler,
    onOutcome: (outcome: PolicyOutcome) => void,
  ) {
    if (!Number.isFinite(policy.milliseconds) || policy.milliseconds <= 0) {
      throw new PolicyError(
        `${policy.kind} needs a positive time, not ${String(policy.milliseconds)}`,
      );
    }
    this.policy = policy;
    this.table = table;
    this.scheduler = scheduler;
    this.onOutcome = onOutcome;
    this.unsubscribe = table.onChange(event => {
      if (event.leases.length === 0) {
        this.armTimer();
      } else {
        this.disarmTimer();
      }
    });
  }

  /** Stops watching and cancels an armed timer. */
  dispose(): void {
    this.unsubscribe();
    this.disarmTimer();
  }

  private armTimer(): void {
    this.disarmTimer();
    this.cancelTimer = this.scheduler.setTimer(this.policy.milliseconds, () => {
      this.cancelTimer = undefined;
      if (this.table.live().length > 0) {
        return;
      }
      this.onOutcome(
        this.policy.kind === 'delayedCheckAfterLastLease'
          ? {kind: 'runActionThenEnd', action: this.policy.action}
          : {kind: 'end'},
      );
    });
  }

  private disarmTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
}
