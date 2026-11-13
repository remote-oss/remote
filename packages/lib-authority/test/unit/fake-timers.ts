/** Timers a test runs by hand: each is kept with its time and whether it is still live, and none fires by itself. */
export class FakeTimers {
  timers: Array<{milliseconds: number; callback: () => void; live: boolean}> =
    [];

  /** Calls `callback` once when the timer is fired; the returned function cancels it. */
  startTimer(milliseconds: number, callback: () => void): () => void {
    const timer = {milliseconds, callback, live: true};
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  /** Runs the timers that are still live, as if their time had passed. */
  fireTimers(): void {
    for (const timer of this.timers) {
      if (timer.live) {
        timer.live = false;
        timer.callback();
      }
    }
  }
}
