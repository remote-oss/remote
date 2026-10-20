/**
 * @fileoverview The live feed of ssh's error-stream lines from the helper to the windows: lines are batched, and a
 * batch leaves at most every 100 ms and holds at most 200 lines. A window that holds the connection hears them while
 * the login runs and after it, until the helper ends.
 */

import type {Scheduler} from 'lib-helper';

/** How long a line waits for the batch it leaves in, in milliseconds. */
export const SSH_LINE_BATCH_MILLISECONDS = 100;

/** The most lines one batch holds. */
export const SSH_LINE_BATCH_LINES = 200;

/** Collects ssh's lines and sends them on in batches. */
export class SshLineFeed {
  private readonly pending: string[] = [];
  private cancelTimer: (() => void) | undefined;
  private readonly send: (lines: string[]) => void;
  private readonly scheduler: Scheduler;

  /** The feed over `send`, which is given each batch, and the scheduler that times the batches. */
  constructor(send: (lines: string[]) => void, scheduler: Scheduler) {
    this.send = send;
    this.scheduler = scheduler;
  }

  /** Adds a line to the batch that leaves next. */
  push(line: string): void {
    this.pending.push(line);
    this.armTimer();
  }

  /** Sends everything that is waiting now, in batches of at most the limit; used before an event that must follow it. */
  flush(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    while (this.pending.length > 0) {
      this.send(this.pending.splice(0, SSH_LINE_BATCH_LINES));
    }
  }

  private armTimer(): void {
    if (this.cancelTimer !== undefined) {
      return;
    }
    this.cancelTimer = this.scheduler.setTimer(
      SSH_LINE_BATCH_MILLISECONDS,
      () => {
        this.cancelTimer = undefined;
        if (this.pending.length > 0) {
          this.send(this.pending.splice(0, SSH_LINE_BATCH_LINES));
        }
        if (this.pending.length > 0) {
          this.armTimer();
        }
      },
    );
  }
}
