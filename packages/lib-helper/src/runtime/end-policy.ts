import type {EndPolicy} from '../types.ts';
import type {LeaseTable} from './leases.ts';

/**
 * A cancelable timer: `setTimer` returns a function that cancels the timer before it fires.
 * The runtime never uses host timers directly; a test hands it this shape.
 */
export interface Scheduler {
  setTimer(milliseconds: number, callback: () => void): () => void;
}

/** What an end policy asks the helper to do when its timer fires. */
export type PolicyOutcome =
  {kind: 'end'} | {kind: 'runActionThenEnd'; action: string};

/** Raised when an end policy's delay is not a positive finite number. */
export class PolicyError extends Error {
  /** Keep the problem as the message. */
  constructor(problem: string) {
    super(problem);
    this.name = 'PolicyError';
  }
}

/**
 * An end policy watching a lease table. It arms the policy's timer when a close leaves the
 * table empty and cancels it when a lease opens, at most one timer at a time; a table that is
 * already empty when the runner is built stays un-armed until a lease is opened and closed.
 * When the timer fires, the table is empty by construction, so the policy's outcome is
 * reported.
 */
export class EndPolicyRunner {
  private readonly table: LeaseTable;
  private readonly onOutcome: (outcome: PolicyOutcome) => void;
  private cancelTimer: (() => void) | undefined;

  /**
   * Build the runner: the policy's delay is checked, so a non-positive or non-finite delay
   * throws `PolicyError` here, and the runner subscribes to the table.
   */
  constructor(
    policy: EndPolicy,
    table: LeaseTable,
    scheduler: Scheduler,
    onOutcome: (outcome: PolicyOutcome) => void,
  ) {
    if (!Number.isFinite(policy.milliseconds) || policy.milliseconds <= 0) {
      throw new PolicyError(
        'the policy delay must be a positive finite number',
      );
    }
    this.table = table;
    this.onOutcome = onOutcome;
    table.onChange(() => {
      if (this.table.live().length > 0) {
        this.cancel();
      } else {
        this.armTimer(policy, scheduler);
      }
    });
  }

  /** Stop the runner, cancelling any armed timer. */
  dispose(): void {
    this.cancel();
  }

  /** Arm the policy's one timer for the policy's delay. */
  private armTimer(policy: EndPolicy, scheduler: Scheduler): void {
    this.cancel();
    this.cancelTimer = scheduler.setTimer(policy.milliseconds, () => {
      this.cancelTimer = undefined;
      const outcome: PolicyOutcome =
        policy.kind === 'delayedCheckAfterLastLease'
          ? {kind: 'runActionThenEnd', action: policy.action}
          : {kind: 'end'};
      this.onOutcome(outcome);
    });
  }

  /** Cancel the armed timer, if any. */
  private cancel(): void {
    if (this.cancelTimer !== undefined) {
      this.cancelTimer();
      this.cancelTimer = undefined;
    }
  }
}
