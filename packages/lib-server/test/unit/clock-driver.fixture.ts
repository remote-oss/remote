/**
 * @fileoverview The fake-clock driver shared by the lock tests: let the immediate queue settle, and run a
 * promise against the clock until it settles or the clock passes the limit.
 */

import type {FakeClock} from '../../src/testing/fake-clock.ts';

/** Let queued microtasks run: a few turns of the immediate queue, enough for a loop to act. */
export async function drain(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise<void>(release => setImmediate(release));
  }
}

/**
 * Run `work` against the clock until it settles: advance by the step each turn, and stop once the work
 * settles or the clock passes the limit.
 */
export function settle<T>(
  work: Promise<T>,
  clock: FakeClock,
  stepMilliseconds: number,
  limitMilliseconds: number,
): Promise<T> {
  const state: {done: boolean} = {done: false};
  return new Promise<T>((resolve, reject) => {
    void work.then(
      value => {
        if (!state.done) {
          state.done = true;
          resolve(value);
        }
      },
      (problem: unknown) => {
        if (!state.done) {
          state.done = true;
          if (problem instanceof Error) {
            reject(problem);
            return;
          }
          reject(new Error('the work rejected with a non-error value'));
        }
      },
    );
    void (async () => {
      while (clock.now() <= limitMilliseconds) {
        await drain();
        if (state.done) {
          break;
        }
        clock.advance(stepMilliseconds);
      }
      if (!state.done) {
        reject(new Error('the clock ran out before the work settled'));
      }
    })();
  });
}
