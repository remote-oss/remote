import type {FakeClock} from 'lib-helper/testing/fake-clock';

/** The bounds the tunnel tests run under: ten seconds to be ready, a pause of half a second between attempts. */
export const LIMITS = {readyMilliseconds: 10_000, retryMilliseconds: 500};

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
