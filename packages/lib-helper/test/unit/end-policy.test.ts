import {deepStrictEqual} from 'node:assert';
import {
  EndPolicyRunner,
  type EndPolicy,
  LeaseTable,
  type PolicyOutcome,
} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';

const grace: EndPolicy = {kind: 'graceAfterLastLease', milliseconds: 3000};
const delayed: EndPolicy = {
  kind: 'delayedCheckAfterLastLease',
  milliseconds: 10000,
  action: 'stopContainers',
};

// A fresh table, a fake clock, and a runner for the policy: the outcomes it reports, in order.
function armed(policy: EndPolicy): {
  clock: FakeClock;
  table: LeaseTable;
  outcomes: PolicyOutcome[];
} {
  const clock = new FakeClock();
  const table = new LeaseTable(clock.now.bind(clock));
  const outcomes: PolicyOutcome[] = [];
  new EndPolicyRunner(policy, table, clock.scheduler(), outcome =>
    outcomes.push(outcome),
  );
  return {clock, table, outcomes};
}

// The grace re-armed rows: open, close, advance, open, close, then a final advance.
function reArmed(finalAdvance: number, expected: PolicyOutcome[]): void {
  const {clock, table, outcomes} = armed(grace);
  table.open();
  table.close(1);
  clock.advance(1000);
  table.open();
  table.close(2);
  clock.advance(finalAdvance);
  deepStrictEqual(outcomes, expected);
}

describe('end policies (card helper-02 table)', () => {
  it('grace 3000: open, close, advance 2999 -> no outcome', () => {
    const {clock, table, outcomes} = armed(grace);
    table.open();
    table.close(1);
    clock.advance(2999);
    deepStrictEqual(outcomes, []);
  });

  it('grace 3000: open, close, advance 3000 -> one outcome {end}', () => {
    const {clock, table, outcomes} = armed(grace);
    table.open();
    table.close(1);
    clock.advance(3000);
    deepStrictEqual(outcomes, [{kind: 'end'}]);
  });

  it('grace 3000: open, close, advance 1000, open, advance 5000 -> no outcome (disarmed by the open)', () => {
    const {clock, table, outcomes} = armed(grace);
    table.open();
    table.close(1);
    clock.advance(1000);
    table.open();
    clock.advance(5000);
    deepStrictEqual(outcomes, []);
  });

  it('grace 3000: open, close, advance 1000, open, close, advance 2999 -> no outcome (re-armed from the second close)', () => {
    reArmed(2999, []);
  });

  it('grace 3000: … then advance 1 -> one outcome {end}', () => {
    reArmed(3000, [{kind: 'end'}]);
  });

  it('idle 45000: open, close, advance 45000 -> one outcome {end}', () => {
    const {clock, table, outcomes} = armed({
      kind: 'idleAfterLastLease',
      milliseconds: 45000,
    });
    table.open();
    table.close(1);
    clock.advance(45000);
    deepStrictEqual(outcomes, [{kind: 'end'}]);
  });

  it('delayedCheck 10000 action stopContainers: open, close, advance 10000 -> one outcome {runActionThenEnd, action: stopContainers}', () => {
    const {clock, table, outcomes} = armed(delayed);
    table.open();
    table.close(1);
    clock.advance(10000);
    deepStrictEqual(outcomes, [
      {kind: 'runActionThenEnd', action: 'stopContainers'},
    ]);
  });

  it('delayedCheck: open, close, advance 9999, open, advance 10 -> no outcome', () => {
    const {clock, table, outcomes} = armed(delayed);
    table.open();
    table.close(1);
    clock.advance(9999);
    table.open();
    clock.advance(10);
    deepStrictEqual(outcomes, []);
  });

  it('two leases, close one, advance past the grace -> no outcome (a lease is live)', () => {
    const {clock, table, outcomes} = armed(grace);
    table.open();
    table.open();
    table.close(1);
    clock.advance(10000);
    deepStrictEqual(outcomes, []);
  });

  it('dispose() after close, then advance past the grace -> no outcome', () => {
    const {clock, table} = armed(grace);
    const outcomes: PolicyOutcome[] = [];
    const runner = new EndPolicyRunner(
      grace,
      table,
      clock.scheduler(),
      outcome => outcomes.push(outcome),
    );
    table.open();
    table.close(1);
    runner.dispose();
    clock.advance(10000);
    deepStrictEqual(outcomes, []);
  });

  it('policy {kind: graceAfterLastLease, milliseconds: 0} -> constructor throws PolicyError; same for -1 and NaN', () => {
    const {clock, table} = armed(grace);
    const outcomes: PolicyOutcome[] = [];
    function throwsDelay(milliseconds: number): boolean {
      try {
        new EndPolicyRunner(
          {kind: 'graceAfterLastLease', milliseconds},
          table,
          clock.scheduler(),
          outcome => outcomes.push(outcome),
        );
      } catch (error) {
        return error instanceof Error && error.message.includes('delay');
      }
      return false;
    }
    deepStrictEqual(
      [throwsDelay(0), throwsDelay(-1), throwsDelay(NaN), outcomes],
      [true, true, true, []],
    );
  });

  it('the runner with a table that is already empty at construction -> armed as if a lease had just closed: advance the delay -> end', () => {
    const {clock, outcomes} = armed(grace);
    clock.advance(3000);
    deepStrictEqual(outcomes, [{kind: 'end'}]);
  });

  it('the runner armed at construction -> a first lease within the delay disarms it', () => {
    const {clock, table, outcomes} = armed(grace);
    clock.advance(2999);
    table.open();
    clock.advance(10000);
    deepStrictEqual(outcomes, []);
  });

  it('dispose -> the runner no longer watches the table: a later open and close arms nothing', () => {
    const clock = new FakeClock();
    const table = new LeaseTable(clock.now.bind(clock));
    const outcomes: PolicyOutcome[] = [];
    const runner = new EndPolicyRunner(
      grace,
      table,
      clock.scheduler(),
      outcome => outcomes.push(outcome),
    );
    runner.dispose();
    table.close(table.open().leaseId);
    clock.advance(10000);
    deepStrictEqual(outcomes, []);
  });

  it('FakeClock: two timers 100 and 50 -> the 50 fires first on advance(100); a timer armed inside a callback for 10 fires within the same advance when it falls inside the window', () => {
    const clock = new FakeClock();
    const scheduler = clock.scheduler();
    const fired: number[] = [];
    scheduler.setTimer(100, () => {
      fired.push(100);
    });
    scheduler.setTimer(50, () => {
      fired.push(50);
      scheduler.setTimer(10, () => {
        fired.push(10);
      });
    });
    clock.advance(100);
    deepStrictEqual(fired, [50, 10, 100]);
  });

  it('FakeClock cancel -> a cancelled timer never fires', () => {
    const clock = new FakeClock();
    const scheduler = clock.scheduler();
    const fired: number[] = [];
    const cancel = scheduler.setTimer(50, () => {
      fired.push(50);
    });
    cancel();
    clock.advance(100);
    deepStrictEqual(fired, []);
  });
});
