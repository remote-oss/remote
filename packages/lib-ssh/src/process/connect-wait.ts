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
  /** The connect timeout in seconds; 0 means the client sets no limit of its own. */
  connectTimeoutSeconds: number;
  /** Whether the timeout is the host's own `ConnectTimeout` (from `ssh -G`) rather than the setting. */
  fromHost: boolean;
  /** The whole wait for a host's `ConnectTimeout 0`, in seconds: the bound on an otherwise unbounded wait, with no margin added. */
  unboundedWaitSeconds: number;
}

/**
 * The length of the connect wait: a host's own `ConnectTimeout 0` waits the ceiling with no margin; any other timeout,
 * the setting's 0 included, waits that many seconds plus the 2 s margin.
 */
export function connectWaitMilliseconds(settings: ConnectWaitSettings): number {
  return settings.connectTimeoutSeconds === 0 && settings.fromHost
    ? settings.unboundedWaitSeconds * MILLISECONDS_PER_SECOND
    : settings.connectTimeoutSeconds * MILLISECONDS_PER_SECOND +
        GRACE_MILLISECONDS;
}

/** The wait for one connection attempt. */
export class ConnectWait {
  private readonly durationMilliseconds: number;
  private readonly scheduler: Scheduler;
  private readonly onTimeout: () => void;
  private cancelTimer: (() => void) | undefined;
  private running = false;
  private lengthFactor = 1;

  /** A wait that has not started; `onTimeout` is called once if the time runs out. */
  constructor(
    settings: ConnectWaitSettings,
    scheduler: Scheduler,
    onTimeout: () => void,
  ) {
    this.durationMilliseconds = connectWaitMilliseconds(settings);
    this.scheduler = scheduler;
    this.onTimeout = onTimeout;
  }

  /** Starts the wait: at the spawn in shared mode, at the platform choice in terminal mode; `lengthFactor` times as long when two stages follow each other. */
  start(lengthFactor = 1): void {
    this.lengthFactor = lengthFactor;
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
      this.durationMilliseconds * this.lengthFactor,
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
