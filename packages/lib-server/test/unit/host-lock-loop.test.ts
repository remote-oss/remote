/**
 * @fileoverview The host-lock wait: attempt once, then after each busy result retry on the interval, up to the
 * attempt bound.
 */

import {deepStrictEqual} from 'node:assert';
import {hostLockLoop} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';
import {settle} from './clock-driver.fixture.ts';

/**
 * Drive the loop with a step that always reports the host lock as taken, recording each retry; the two
 * unbounded rows share it.
 */
function busyLoop(
  clock: FakeClock,
  attempts?: number,
  intervalMilliseconds?: number,
) {
  const retries: number[] = [];
  const promise = hostLockLoop(
    () => Promise.resolve({kind: 'lockBusy'} as const),
    clock,
    attempt => retries.push(attempt),
    attempts,
    intervalMilliseconds,
  );
  return {promise, retries};
}

/** The retry notices of the first `count` busy attempts: 1, 2, ... count. */
function firstRetries(count: number): number[] {
  const expected: number[] = [];
  for (let attempt = 1; attempt <= count; attempt += 1) {
    expected.push(attempt);
  }
  return expected;
}

describe('host lock loop (card server-05 table)', () => {
  it('step returns result at once: done, onRetry never called, the clock unchanged', async () => {
    const clock = new FakeClock();
    const retries: number[] = [];
    const promise = hostLockLoop(
      () => Promise.resolve({kind: 'result', value: 7} as const),
      clock,
      attempt => retries.push(attempt),
    );
    const result = await settle(promise, clock, 1000, 0);
    deepStrictEqual(
      {result, retries, clock: clock.now()},
      {result: {kind: 'done', value: 7}, retries: [], clock: 0},
    );
  });

  it('busy twice then result: done; onRetry(1), onRetry(2); the clock advanced 2000 ms', async () => {
    const clock = new FakeClock();
    const retries: number[] = [];
    let busy = 2;
    function step() {
      if (busy > 0) {
        busy -= 1;
        return Promise.resolve({kind: 'lockBusy'} as const);
      }
      return Promise.resolve({kind: 'result', value: 8} as const);
    }
    const promise = hostLockLoop(step, clock, attempt => retries.push(attempt));
    const result = await settle(promise, clock, 1000, 2000);
    deepStrictEqual(
      {result, retries, clock: clock.now()},
      {result: {kind: 'done', value: 8}, retries: [1, 2], clock: 2000},
    );
  });

  it('busy 30 times: retriesExhausted; onRetry called 1..29 (no wait after the last attempt)', async () => {
    const clock = new FakeClock();
    const {promise, retries} = busyLoop(clock);
    const result = await settle(promise, clock, 1000, 29000);
    deepStrictEqual(
      {result, retries, clock: clock.now()},
      {
        result: {kind: 'retriesExhausted'},
        retries: firstRetries(29),
        clock: 29000,
      },
    );
  });

  it('busy 29 times then result: done on attempt 30', async () => {
    const clock = new FakeClock();
    const retries: number[] = [];
    let busy = 29;
    function step() {
      if (busy > 0) {
        busy -= 1;
        return Promise.resolve({kind: 'lockBusy'} as const);
      }
      return Promise.resolve({kind: 'result', value: 9} as const);
    }
    const promise = hostLockLoop(step, clock, attempt => retries.push(attempt));
    const result = await settle(promise, clock, 1000, 29000);
    deepStrictEqual(
      {result, retries, clock: clock.now()},
      {
        result: {kind: 'done', value: 9},
        retries: firstRetries(29),
        clock: 29000,
      },
    );
  });

  it('attempts = 1, busy once: retriesExhausted, onRetry not called', async () => {
    const clock = new FakeClock();
    const {promise, retries} = busyLoop(clock, 1, 1000);
    const result = await settle(promise, clock, 1000, 0);
    deepStrictEqual(
      {result, retries, clock: clock.now()},
      {result: {kind: 'retriesExhausted'}, retries: [], clock: 0},
    );
  });
});
