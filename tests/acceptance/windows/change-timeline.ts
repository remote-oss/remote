/**
 * @fileoverview What a window showed over time, kept as the changes of one read taken every few hundred milliseconds,
 * so that a dialog that appeared and was closed again is told from one that never appeared (card #2753). It imports
 * nothing from the harness or the editor, so that the tools project can test it.
 */

/** The clock and the pause of a timeline, which a test replaces. */
export interface TimelineEnvironment {
  now(): number;
  pause(milliseconds: number): Promise<void>;
}

const REAL_ENVIRONMENT: TimelineEnvironment = {
  now: Date.now,
  pause: milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)),
};

/** A timeline that is being taken. */
export interface ChangeTimeline {
  /** Ends the sampling after the read in progress, and resolves once it has ended. */
  stop(): Promise<void>;
  /** Resolves when the sampling has ended, by `stop` or by its time. */
  finished: Promise<void>;
  /** The changes so far, each with its seconds from the start. */
  lines(): string[];
}

/**
 * Reads `read` every `everyMilliseconds` from now until `stop` or `forMilliseconds` after `startedAt`, and keeps each
 * value that differs from the one before with its seconds from `startedAt`. A read that throws is kept as its text.
 */
export function changeTimeline(
  read: () => Promise<string>,
  startedAt: number,
  everyMilliseconds: number,
  forMilliseconds: number,
  environment: TimelineEnvironment = REAL_ENVIRONMENT,
): ChangeTimeline {
  const kept: string[] = [];
  let stopped = false;
  async function sample(): Promise<void> {
    let last: string | undefined;
    while (!stopped && environment.now() - startedAt <= forMilliseconds) {
      let value: string;
      try {
        value = await read();
      } catch (caught) {
        value = `(unreadable: ${String(caught)})`;
      }
      if (value !== last) {
        kept.push(
          `[+${((environment.now() - startedAt) / 1000).toFixed(2)} s] ${value}`,
        );
        last = value;
      }
      await environment.pause(everyMilliseconds);
    }
  }
  const running = sample();
  return {
    finished: running,
    stop: () => {
      stopped = true;
      return running;
    },
    lines: () => [...kept],
  };
}
