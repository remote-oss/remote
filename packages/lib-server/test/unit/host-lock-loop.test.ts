/**
 * @fileoverview The host-lock wait: attempt once, then after each busy result retry on the interval, up to the
 * attempt bound.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {hostLockLoop} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';
import {settle} from './clock-driver.fixture.ts';

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
    deepStrictEqual(result, {kind: 'done', value: 7});
    deepStrictEqual(retries, []);
    strictEqual(clock.now(), 0);
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
    deepStrictEqual(result, {kind: 'done', value: 8});
    deepStrictEqual(retries, [1, 2]);
    strictEqual(clock.now(), 2000);
  });

  it('busy 30 times: retriesExhausted; onRetry called 1..29 (no wait after the last attempt)', async () => {
    const clock = new FakeClock();
    const retries: number[] = [];
    const promise = hostLockLoop(
      () => Promise.resolve({kind: 'lockBusy'} as const),
      clock,
      attempt => retries.push(attempt),
    );
    const result = await settle(promise, clock, 1000, 29000);
    deepStrictEqual(result, {kind: 'retriesExhausted'});
    const expected = new Array<number>(29);
    for (let index = 0; index < 29; index += 1) {
      expected[index] = index + 1;
    }
    deepStrictEqual(retries, expected);
    strictEqual(clock.now(), 29000);
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
    deepStrictEqual(result, {kind: 'done', value: 9});
    strictEqual(retries.length, 29);
    strictEqual(clock.now(), 29000);
  });

  it('attempts = 1, busy once: retriesExhausted, onRetry not called', async () => {
    const clock = new FakeClock();
    const retries: number[] = [];
    const promise = hostLockLoop(
      () => Promise.resolve({kind: 'lockBusy'} as const),
      clock,
      attempt => retries.push(attempt),
      1,
      1000,
    );
    const result = await settle(promise, clock, 1000, 0);
    deepStrictEqual(result, {kind: 'retriesExhausted'});
    deepStrictEqual(retries, []);
    strictEqual(clock.now(), 0);
  });
});
