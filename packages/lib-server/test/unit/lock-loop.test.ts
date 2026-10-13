/**
 * @fileoverview The host lock loop of an extension, over a fake clock: a step busy twice and then a result, and a step
 * that stays busy.
 */

import {deepStrictEqual} from 'node:assert';
import {hostLockLoopOf, type StepRun} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';
import {settle} from './clock-driver.fixture.ts';

function resultWith(status: 'Ok' | 'LockBusy'): StepRun {
  return {
    kind: 'result',
    block: {status, hostFacts: {}, serverFacts: {}, cliFacts: {}, timings: {}},
    exitStatus: 0,
  };
}

describe('hostLockLoopOf (V5)', () => {
  it('V5: a step busy twice and then a result runs three times and waits the interval twice', async () => {
    const clock = new FakeClock();
    const answers = [
      resultWith('LockBusy'),
      resultWith('LockBusy'),
      resultWith('Ok'),
    ];
    let runs = 0;
    const loop = hostLockLoopOf(clock, 5, 250);
    const outcome = await settle(
      loop(() => {
        runs += 1;
        return Promise.resolve(answers[runs - 1] ?? resultWith('Ok'));
      }, new AbortController().signal),
      clock,
      250,
      5000,
    );
    deepStrictEqual(
      [outcome, runs, clock.waitSteps()],
      [answers[2], 3, [250, 250]],
    );
  });

  it('V5: a step that stays busy ends as retries exhausted after the attempts', async () => {
    const clock = new FakeClock();
    let runs = 0;
    const loop = hostLockLoopOf(clock, 3, 100);
    const outcome = await settle(
      loop(() => {
        runs += 1;
        return Promise.resolve(resultWith('LockBusy'));
      }, new AbortController().signal),
      clock,
      100,
      5000,
    );
    deepStrictEqual(
      [
        outcome.kind,
        outcome.kind === 'retriesExhausted' ? outcome.attempts : undefined,
        runs,
      ],
      ['retriesExhausted', 3, 3],
    );
  });

  it('V5: a step that does not report a result block is passed on, not retried', async () => {
    const clock = new FakeClock();
    const stepRun: StepRun = {kind: 'noResultBlock', exitStatus: 1};
    const loop = hostLockLoopOf(clock, 3, 100);
    const outcome = await settle(
      loop(() => Promise.resolve(stepRun), new AbortController().signal),
      clock,
      100,
      5000,
    );
    deepStrictEqual(outcome, stepRun);
  });
});
