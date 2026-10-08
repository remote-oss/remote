/**
 * @fileoverview The leases a helper holds for its clients, in the order they arrived.
 */

/** One client's hold on the helper. */
export interface Lease {
  /** 1, 2, 3, … in order of arrival, never reused. */
  readonly id: number;
  readonly openedAt: number;
}

/** A change of the live leases, carrying the list after it. */
export interface LeaseEvent {
  kind: 'leaseListChanged';
  leases: readonly Lease[];
}

/** The live leases of a helper. */
export class LeaseTable {
  private readonly clock: () => number;
  private readonly leases: Lease[] = [];
  private readonly listeners = new Set<(event: LeaseEvent) => void>();
  private lastId = 0;

  /** A table with no lease, stamping leases with `clock`. */
  constructor(clock: () => number) {
    this.clock = clock;
  }

  /** Opens the next lease. */
  open(): Lease {
    this.lastId += 1;
    const lease = {id: this.lastId, openedAt: this.clock()};
    this.leases.push(lease);
    this.notify();
    return lease;
  }

  /** Closes a live lease; false when the id is unknown or already closed. */
  close(leaseId: number): boolean {
    const position = this.leases.findIndex(lease => lease.id === leaseId);
    if (position < 0) {
      return false;
    }
    this.leases.splice(position, 1);
    this.notify();
    return true;
  }

  /** The live leases, oldest first. */
  live(): readonly Lease[] {
    return [...this.leases];
  }

  /** The oldest live lease, if any. */
  oldest(): Lease | undefined {
    return this.leases[0];
  }

  /** Calls `listener` after every open and close; the returned function stops it. */
  onChange(listener: (event: LeaseEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const event: LeaseEvent = {kind: 'leaseListChanged', leases: this.live()};
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
