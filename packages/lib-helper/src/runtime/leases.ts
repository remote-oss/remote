/** One lease on a helper: its number and when it was opened. */
export interface Lease {
  /** The lease's number, 1, 2, 3, ... in arrival order; never reused. */
  readonly leaseId: number;
  /** The clock value when the lease was opened. */
  readonly openedAt: number;
}

/** One report that the live leases changed. */
export interface LeaseEvent {
  kind: 'leaseListChanged';
  /** The live leases at that moment, oldest first. */
  leases: readonly Lease[];
}

/**
 * The live leases of one helper, numbered in arrival order. A lease opens with the clock's
 * value and closes to leave the table; ids are never reused. Every open and close fires one
 * `leaseListChanged` event; a close of an unknown or already closed id changes nothing and
 * fires nothing.
 */
export class LeaseTable {
  private nextId = 1;
  private readonly active: Lease[] = [];
  private readonly listeners = new Set<(event: LeaseEvent) => void>();

  /** The clock the leases read their open time from, so the table stays pure for tests. */
  private readonly clock: () => number;

  /**
   * The table reads the leases' open time from `clock`, so the tests drive the clock.
   */
  constructor(clock: () => number) {
    this.clock = clock;
  }

  /** Open a lease: the next id in arrival order, stamped with the clock's value. */
  open(): Lease {
    const lease: Lease = {leaseId: this.nextId, openedAt: this.clock()};
    this.nextId += 1;
    this.active.push(lease);
    this.fire();
    return lease;
  }

  /**
   * Close a lease by its leaseId. False when the leaseId is unknown or the lease already closed, with no
   * change event.
   */
  close(leaseId: number): boolean {
    const index = this.active.findIndex(lease => lease.leaseId === leaseId);
    if (index === -1) {
      return false;
    }
    this.active.splice(index, 1);
    this.fire();
    return true;
  }

  /** The live leases, oldest first. */
  live(): readonly Lease[] {
    return [...this.active];
  }

  /** The oldest live lease, or none when the table is empty. */
  oldest(): Lease | undefined {
    return this.active[0];
  }

  /**
   * Watch the table: the listener gets one `leaseListChanged` event on every open and close,
   * with the live leases at that moment, and the return value stops it.
   */
  onChange(listener: (event: LeaseEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tell every listener the live list changed. */
  private fire(): void {
    const event: LeaseEvent = {kind: 'leaseListChanged', leases: this.live()};
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}
