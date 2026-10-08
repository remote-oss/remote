import type {Scheduler} from '../runtime/end-policy.ts';

/** One timer on a fake clock: its deadline and what it does. */
interface PendingTimer {
  deadline: number;
  callback: () => void;
}

/**
 * A clock that only moves when a test moves it. Timers fire in due order on `advance`, and a
 * timer armed inside a callback fires within the same advance when its deadline falls inside
 * the stepped window.
 */
export class FakeClock {
  private time = 0;
  private pending: PendingTimer[] = [];

  /** The clock's current time. */
  now(): number {
    return this.time;
  }

  /**
   * Move the clock forward by a window: fire timers in due order until the earliest due time
   * passes the window's end, including timers armed while a callback runs.
   */
  advance(milliseconds: number): void {
    const target = this.time + milliseconds;
    for (;;) {
      if (this.pending.length === 0) {
        break;
      }
      const minDue = Math.min(...this.pending.map(timer => timer.deadline));
      if (minDue > target) {
        break;
      }
      this.time = minDue;
      for (const [index, timer] of this.pending.entries()) {
        if (timer.deadline === minDue) {
          this.pending.splice(index, 1);
          timer.callback();
          break;
        }
      }
    }
    this.time = target;
  }

  /** A scheduler whose timers run on this clock and cancel on the returned function. */
  scheduler(): Scheduler {
    return {
      setTimer: (milliseconds, callback) => {
        this.pending.push({deadline: this.time + milliseconds, callback});
        const armed = this.pending.at(-1);
        return () => {
          if (armed !== undefined) {
            this.pending = this.pending.filter(timer => timer !== armed);
          }
        };
      },
    };
  }
}
