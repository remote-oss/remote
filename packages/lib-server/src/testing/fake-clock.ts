import type {Clock} from '../locks/client-lock.ts';

/**
 * A clock that only moves when a test moves it: `wait` settles on the next `advance`, which
 * fires every pending wait in one call. A test drives the clock by the same step the module
 * waits for, so every wait is due when the clock advances.
 */
export class FakeClock implements Clock {
  private time = 0;
  private readonly waiters: Array<() => void> = [];
  /** The step of every wait, in order, so a test can assert the wait sequence. */
  private readonly waitStepMilliseconds: number[] = [];

  /** The clock's current time. */
  now(): number {
    return this.time;
  }

  /** Settle once the clock advances; record the step, the wait sequence a test asserts. */
  wait(milliseconds: number): Promise<void> {
    this.waitStepMilliseconds.push(milliseconds);
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  /** Move the clock forward by a window, settling every pending wait. */
  advance(milliseconds: number): void {
    const fired = this.waiters.slice();
    this.waiters.length = 0;
    for (const wake of fired) {
      wake();
    }
    this.time += milliseconds;
  }

  /** The step of every wait, in order. */
  waitSteps(): readonly number[] {
    return this.waitStepMilliseconds;
  }
}
