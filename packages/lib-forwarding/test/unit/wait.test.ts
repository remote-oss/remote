import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {succeedsWithin} from '../../src/index.ts';
import {advanced, LIMITS, settled} from './timing.fixture.ts';

describe('waiting for an attempt to work within a bound', () => {
  it('is true at once for an attempt that works', async () => {
    const clock = new FakeClock();
    deepStrictEqual(
      await succeedsWithin(() => Promise.resolve(), LIMITS, clock.scheduler()),
      true,
    );
  });

  it('tries again after the pause, and not before it', async () => {
    const clock = new FakeClock();
    let attempts = 0;
    const pending = succeedsWithin(
      () => {
        attempts += 1;
        return attempts < 3
          ? Promise.reject(new Error('no'))
          : Promise.resolve();
      },
      LIMITS,
      clock.scheduler(),
    );
    await settled();
    const beforePause = attempts;
    await advanced(clock, 500);
    await advanced(clock, 500);
    deepStrictEqual([beforePause, attempts, await pending], [1, 3, true]);
  });

  it('is false at the bound for an attempt that never ends', async () => {
    const clock = new FakeClock();
    const pending = succeedsWithin(
      () => new Promise<void>(() => undefined),
      LIMITS,
      clock.scheduler(),
    );
    await advanced(clock, 10_000);
    deepStrictEqual(await pending, false);
  });

  it('makes no further attempt once the bound has passed, even if the last one fails late', async () => {
    const clock = new FakeClock();
    let attempts = 0;
    let failLate: (() => void) | undefined;
    const pending = succeedsWithin(
      () => {
        attempts += 1;
        return new Promise<void>((resolve, reject) => {
          failLate = () => {
            reject(new Error('late'));
          };
        });
      },
      LIMITS,
      clock.scheduler(),
    );
    await advanced(clock, 10_000);
    failLate?.();
    await advanced(clock, 5_000);
    deepStrictEqual([await pending, attempts], [false, 1]);
  });

  it('stays false when an attempt works after the bound has passed', async () => {
    const clock = new FakeClock();
    let workLate: (() => void) | undefined;
    const pending = succeedsWithin(
      () =>
        new Promise<void>(resolve => {
          workLate = resolve;
        }),
      LIMITS,
      clock.scheduler(),
    );
    await advanced(clock, 10_000);
    workLate?.();
    await settled();
    deepStrictEqual(await pending, false);
  });
});
