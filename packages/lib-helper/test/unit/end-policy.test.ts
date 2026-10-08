import {deepStrictEqual, throws} from 'node:assert';
import {
  type EndPolicy,
  EndPolicyRunner,
  LeaseTable,
  PolicyError,
  type PolicyOutcome,
} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';

const GRACE: EndPolicy = {kind: 'graceAfterLastLease', milliseconds: 3000};

describe('EndPolicyRunner', () => {
  let clock: FakeClock;
  let table: LeaseTable;
  let outcomes: PolicyOutcome[];

  function runnerFor(policy: EndPolicy): EndPolicyRunner {
    return new EndPolicyRunner(policy, table, clock.scheduler(), outcome =>
      outcomes.push(outcome),
    );
  }

  function openAndClose(): void {
    table.close(table.open().id);
  }

  beforeEach(() => {
    clock = new FakeClock();
    table = new LeaseTable(() => clock.time());
    outcomes = [];
  });

  it('grace: does not end before the time is up', () => {
    runnerFor(GRACE);
    openAndClose();
    clock.advance(2999);
    deepStrictEqual(outcomes, []);
  });

  it('grace: ends once when the time is up', () => {
    runnerFor(GRACE);
    openAndClose();
    clock.advance(3000);
    deepStrictEqual(outcomes, [{kind: 'end'}]);
  });

  it('grace: a lease that opens in time disarms it', () => {
    runnerFor(GRACE);
    openAndClose();
    clock.advance(1000);
    table.open();
    clock.advance(5000);
    deepStrictEqual(outcomes, []);
  });

  it('grace: re-arms from the next close', () => {
    runnerFor(GRACE);
    openAndClose();
    clock.advance(1000);
    openAndClose();
    clock.advance(2999);
    deepStrictEqual(outcomes, []);
  });

  it('grace: ends at the full time after the second close', () => {
    runnerFor(GRACE);
    openAndClose();
    clock.advance(1000);
    openAndClose();
    clock.advance(3000);
    deepStrictEqual(outcomes, [{kind: 'end'}]);
  });

  it('idle: ends when the idle time is up', () => {
    runnerFor({kind: 'idleAfterLastLease', milliseconds: 45000});
    openAndClose();
    clock.advance(45000);
    deepStrictEqual(outcomes, [{kind: 'end'}]);
  });

  it('delayed check: runs the action, then ends, when the list is still empty', () => {
    runnerFor({
      kind: 'delayedCheckAfterLastLease',
      milliseconds: 10000,
      action: 'stopContainers',
    });
    openAndClose();
    clock.advance(10000);
    deepStrictEqual(outcomes, [
      {kind: 'runActionThenEnd', action: 'stopContainers'},
    ]);
  });

  it('delayed check: a lease that opens in time disarms it', () => {
    runnerFor({
      kind: 'delayedCheckAfterLastLease',
      milliseconds: 10000,
      action: 'stopContainers',
    });
    openAndClose();
    clock.advance(9999);
    table.open();
    clock.advance(10);
    deepStrictEqual(outcomes, []);
  });

  it('does not arm while a lease is live', () => {
    runnerFor(GRACE);
    table.open();
    openAndClose();
    clock.advance(10000);
    deepStrictEqual(outcomes, []);
  });

  it('ends nothing after dispose', () => {
    const runner = runnerFor(GRACE);
    openAndClose();
    runner.dispose();
    clock.advance(10000);
    deepStrictEqual(outcomes, []);
  });

  for (const milliseconds of [0, -1, Number.NaN]) {
    it(`refuses a policy time of ${String(milliseconds)}`, () => {
      throws(
        () => runnerFor({kind: 'graceAfterLastLease', milliseconds}),
        PolicyError,
      );
    });
  }

  it('does not arm on an empty table at construction', () => {
    runnerFor(GRACE);
    clock.advance(100000);
    deepStrictEqual(outcomes, []);
  });

  it('arms after the first lease of a table that was empty at construction', () => {
    runnerFor(GRACE);
    clock.advance(100000);
    openAndClose();
    clock.advance(3000);
    deepStrictEqual(outcomes, [{kind: 'end'}]);
  });

  it('does nothing when its timer fires while a lease is live', () => {
    const fired: Array<() => void> = [];
    new EndPolicyRunner(
      GRACE,
      table,
      {
        setTimer: (milliseconds, callback) => {
          fired.push(callback);
          return () => undefined;
        },
      },
      outcome => outcomes.push(outcome),
    );
    openAndClose();
    table.open();
    fired[0]?.();
    deepStrictEqual(outcomes, []);
  });
});

describe('FakeClock', () => {
  it('fires timers in time order', () => {
    const clock = new FakeClock();
    const fired: number[] = [];
    clock.scheduler().setTimer(100, () => fired.push(100));
    clock.scheduler().setTimer(50, () => fired.push(50));
    clock.advance(100);
    deepStrictEqual(fired, [50, 100]);
  });

  it('fires a timer armed by a callback within the same advance', () => {
    const clock = new FakeClock();
    const fired: number[] = [];
    clock.scheduler().setTimer(50, () => {
      clock.scheduler().setTimer(10, () => fired.push(clock.time()));
    });
    clock.advance(100);
    deepStrictEqual(fired, [60]);
  });

  it('fires timers due at the same time in arming order', () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    clock.scheduler().setTimer(50, () => fired.push('first'));
    clock.scheduler().setTimer(50, () => fired.push('second'));
    clock.advance(50);
    deepStrictEqual(fired, ['first', 'second']);
  });

  it('never fires a cancelled timer', () => {
    const clock = new FakeClock();
    const fired: number[] = [];
    const cancel = clock.scheduler().setTimer(50, () => fired.push(50));
    cancel();
    clock.advance(100);
    deepStrictEqual(fired, []);
  });
});
