/**
 * @fileoverview A clock whose time moves only when a test advances it, with timers that fire in time order.
 */

import type {Scheduler} from '../runtime/end-policy.ts';

interface PendingTimer {
  dueAt: number;
  order: number;
  callback: () => void;
}

/** Time and timers under a test's control. */
export class FakeClock {
  private currentTime = 0;
  private armedCount = 0;
  private readonly timers = new Set<PendingTimer>();

  /** The current time in milliseconds. */
  time(): number {
    return this.currentTime;
  }

  /**
   * Moves time forward, firing each timer that falls due by the end, earliest first and in arming order on a tie,
   * timers armed by a callback included.
   */
  advance(milliseconds: number): void {
    const end = this.currentTime + milliseconds;
    for (let next = this.nextDue(end); next; next = this.nextDue(end)) {
      this.timers.delete(next);
      this.currentTime = next.dueAt;
      next.callback();
    }
    this.currentTime = end;
  }

  /** A scheduler on this clock. */
  scheduler(): Scheduler {
    return {
      setTimer: (milliseconds, callback) => {
        this.armedCount += 1;
        const timer = {
          dueAt: this.currentTime + milliseconds,
          order: this.armedCount,
          callback,
        };
        this.timers.add(timer);
        return () => {
          this.timers.delete(timer);
        };
      },
    };
  }

  private nextDue(end: number): PendingTimer | undefined {
    let earliest: PendingTimer | undefined;
    for (const timer of this.timers) {
      if (
        timer.dueAt <= end &&
        (earliest === undefined ||
          timer.dueAt < earliest.dueAt ||
          (timer.dueAt === earliest.dueAt && timer.order < earliest.order))
      ) {
        earliest = timer;
      }
    }
    return earliest;
  }
}
