import type {FakeClock} from 'lib-helper/testing/fake-clock';

/** The tunnel test bounds: ten seconds to be ready, half a second between attempts, eight held bytes per bridge. */
export const LIMITS = {
  readyMilliseconds: 10_000,
  retryMilliseconds: 500,
  heldBytesMaximum: 8,
};

/** Lets the promises that are ready run, so that timers and attempts interleave as they would in time. */
export async function settled(): Promise<void> {
  for (let round = 0; round < 10; round++) {
    await Promise.resolve();
  }
}

/** Runs what is ready, moves the clock, and runs what that makes ready. */
export async function advanced(
  clock: FakeClock,
  milliseconds: number,
): Promise<void> {
  await settled();
  clock.advance(milliseconds);
  await settled();
}
