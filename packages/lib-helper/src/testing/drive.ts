import type {FakeClock} from './fake-clock.ts';

const ROUNDS_PER_STEP = 20;

const MAXIMUM_STEPS = 400;

const STEP_MILLISECONDS = 100;

/**
 * Runs `promise` to its end, moving the fake clock on in steps while it waits on timers; the work of the fake
 * endpoints runs between the steps. Gives up moving the clock after a bound, so a promise that never settles ends
 * the test by its own timeout rather than by looping.
 */
export async function drive<T>(
  promise: Promise<T>,
  clock: FakeClock,
): Promise<T> {
  const state = {done: false};
  function finish(): void {
    state.done = true;
  }
  void promise.then(finish, finish);
  for (let step = 0; step < MAXIMUM_STEPS && !state.done; step++) {
    for (let round = 0; round < ROUNDS_PER_STEP; round++) {
      await Promise.resolve();
    }
    clock.advance(STEP_MILLISECONDS);
  }
  return promise;
}
