import {deepStrictEqual, strictEqual} from 'node:assert';
import {type LeaseEvent, LeaseTable} from '../../src/index.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';

function idsOf(table: LeaseTable): number[] {
  return table.live().map(lease => lease.id);
}

describe('LeaseTable', () => {
  let clock: FakeClock;
  let table: LeaseTable;

  beforeEach(() => {
    clock = new FakeClock();
    table = new LeaseTable(() => clock.time());
  });

  it('numbers leases 1, 2, 3 in order of arrival, oldest first', () => {
    table.open();
    table.open();
    table.open();
    deepStrictEqual([idsOf(table), table.oldest()?.id], [[1, 2, 3], 1]);
  });

  it('closes a live lease', () => {
    table.open();
    table.open();
    table.open();
    deepStrictEqual(
      [table.close(1), idsOf(table), table.oldest()?.id],
      [true, [2, 3], 2],
    );
  });

  it('refuses a closed or unknown lease, with no change event', () => {
    table.open();
    table.close(1);
    const events: LeaseEvent[] = [];
    table.onChange(event => events.push(event));
    deepStrictEqual(
      [table.close(1), table.close(99), events],
      [false, false, []],
    );
  });

  it('never reuses an id', () => {
    table.close(table.open().id);
    deepStrictEqual([table.open().id, table.oldest()?.id], [2, 2]);
  });

  it('reports every open and close with the list after it, until unsubscribed', () => {
    const events: LeaseEvent[] = [];
    const unsubscribe = table.onChange(event => events.push(event));
    const lease = table.open();
    table.close(lease.id);
    unsubscribe();
    table.open();
    deepStrictEqual(events, [
      {kind: 'leaseListChanged', leases: [lease]},
      {kind: 'leaseListChanged', leases: []},
    ]);
  });

  it('stamps a lease with the clock at its opening', () => {
    clock.advance(1234);
    strictEqual(table.open().openedAt, 1234);
  });
});
