/**
 * @fileoverview The connect wait of a run: how long the client may take to report that the connection is set up.
 * It is the connect timeout plus two seconds (the margin on the client's own timeout), pauses while a prompt waits for the user, starts over after each
 * answer, and counts the time a user's own askpass takes, because that program is not ours to pause.
 */

import type {Scheduler} from 'lib-helper';

/** The grace added to the client's own connect timeout, in milliseconds. */
const GRACE_MILLISECONDS = 2000;

const MILLISECONDS_PER_SECOND = 1000;

/** What decides the length of the wait. */
export interface ConnectWaitSettings {
  /** The connect timeout setting, in seconds; 0 means the client sets no limit of its own. */
  connectTimeoutSeconds: number;
  /**
   * The whole wait when the connect timeout is 0, in seconds: the bound on an otherwise unbounded wait. The client
   * has no timeout of its own then, so no margin is added to it.
   */
  unboundedWaitSeconds: number;
}

/** The wait for one connection attempt. */
export class ConnectWait {
  private readonly durationMilliseconds: number;
  private readonly scheduler: Scheduler;
  private readonly onTimeout: () => void;
  private cancelTimer: (() => void) | undefined;
  private running = false;

  /** A wait that has not started; `onTimeout` is called once if the time runs out. */
  constructor(
    settings: ConnectWaitSettings,
    scheduler: Scheduler,
    onTimeout: () => void,
  ) {
    this.durationMilliseconds =
      settings.connectTimeoutSeconds > 0
        ? settings.connectTimeoutSeconds * MILLISECONDS_PER_SECOND +
          GRACE_MILLISECONDS
        : settings.unboundedWaitSeconds * MILLISECONDS_PER_SECOND;
    this.scheduler = scheduler;
    this.onTimeout = onTimeout;
  }

  /** Starts the wait: at the spawn in shared mode, at the platform choice in terminal mode. */
  start(): void {
    this.running = true;
    this.armTimer();
  }

  /** Pauses the wait while a prompt is open. */
  promptOpened(): void {
    this.cancel();
  }

  /** Starts the full wait over after an answer. */
  promptAnswered(): void {
    if (this.running) {
      this.armTimer();
    }
  }

  /** Ends the wait at the first setup report; nothing fires afterwards. */
  stop(): void {
    this.running = false;
    this.cancel();
  }

  private armTimer(): void {
    this.cancel();
    this.cancelTimer = this.scheduler.setTimer(
      this.durationMilliseconds,
      () => {
        this.cancelTimer = undefined;
        this.running = false;
        this.onTimeout();
      },
    );
  }

  private cancel(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
  }
}
