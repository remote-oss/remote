import {deepStrictEqual, strictEqual} from 'node:assert';
import {LeaseTable, type Lease, type LeaseEvent} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';

describe('leases (card helper-02 table)', () => {
  it('open() three times -> leaseIds 1, 2, 3; live() in that order; oldest().leaseId === 1', () => {
    const clock = new FakeClock();
    const table = new LeaseTable(clock.now.bind(clock));
    const leases = [table.open(), table.open(), table.open()];
    deepStrictEqual(
      [
        leases.map(lease => lease.leaseId),
        table.live().map(lease => lease.leaseId),
        table.oldest()?.leaseId,
      ],
      [[1, 2, 3], [1, 2, 3], 1],
    );
  });

  it('close(1) -> live() is [2, 3]; oldest().leaseId === 2; returns true', () => {
    const clock = new FakeClock();
    const table = new LeaseTable(clock.now.bind(clock));
    table.open();
    table.open();
    table.open();
    const closed = table.close(1);
    deepStrictEqual(
      [
        closed,
        table.live().map(lease => lease.leaseId),
        table.oldest()?.leaseId,
      ],
      [true, [2, 3], 2],
    );
  });

  it('close(1) again; close(99) -> both false; no change event', () => {
    const clock = new FakeClock();
    const table = new LeaseTable(clock.now.bind(clock));
    table.open();
    const first = table.close(1);
    const events: LeaseEvent[] = [];
    table.onChange(event => events.push(event));
    const again = table.close(1);
    const unknown = table.close(99);
    deepStrictEqual(
      [first, again, unknown, events.length],
      [true, false, false, 0],
    );
  });

  it('after closing all, open() -> leaseId 4 (never reused); oldest().leaseId === 4', () => {
    const clock = new FakeClock();
    const table = new LeaseTable(clock.now.bind(clock));
    const leases = [table.open(), table.open(), table.open()];
    const closed = leases.map(lease => table.close(lease.leaseId));
    const next = table.open();
    deepStrictEqual(
      [closed, next.leaseId, table.oldest()?.leaseId],
      [[true, true, true], 4, 4],
    );
  });

  it('onChange listener; open, close -> two events, leases arrays equal live() at each moment; the unsubscribe stops further events', () => {
    const clock = new FakeClock();
    const table = new LeaseTable(clock.now.bind(clock));
    const events: LeaseEvent[] = [];
    const unsubscribe = table.onChange(event => events.push(event));
    const lease: Lease = table.open();
    const afterOpen = events.map(event =>
      event.leases.map(entry => entry.leaseId),
    );
    const closed = table.close(lease.leaseId);
    unsubscribe();
    table.open();
    deepStrictEqual(
      [
        afterOpen,
        closed,
        events.map(event => event.leases.map(entry => entry.leaseId)),
        events.length,
      ],
      [[[1]], true, [[1], []], 2],
    );
  });

  it('openedAt -> equals the clock value at open()', () => {
    const clock = new FakeClock();
    const table = new LeaseTable(clock.now.bind(clock));
    clock.advance(15);
    const lease: Lease = table.open();
    clock.advance(5);
    strictEqual(lease.openedAt, 15);
  });
});
