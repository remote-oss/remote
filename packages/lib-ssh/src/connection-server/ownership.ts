/**
 * @fileoverview Who owns the login of a shared connection. The first lease owns the login; when the owner cancels, its
 * lease closes or its login fails, the oldest lease that still waits takes over.
 */

/** The owner of the login among the live leases. */
export class LoginOwnership {
  private readonly onOwnerChanged: (owner: number) => void;
  private owner: number | undefined;
  private live: readonly number[] = [];
  private readonly gaveUp = new Set<number>();
  private finished = false;

  /** Tracking with no lease yet; `onOwnerChanged` is told each time a lease becomes the owner. */
  constructor(onOwnerChanged: (owner: number) => void) {
    this.onOwnerChanged = onOwnerChanged;
  }

  /** The owner's lease, or undefined while there is none. */
  current(): number | undefined {
    return this.owner;
  }

  /** The live leases that are not the owner, oldest first. */
  waiting(): number[] {
    return this.live.filter(leaseId => leaseId !== this.owner);
  }

  /** The live leases changed, `leaseIds` oldest first. A lease that closed can no longer own the login. */
  leasesChanged(leaseIds: readonly number[]): void {
    this.live = [...leaseIds];
    for (const leaseId of this.gaveUp) {
      if (!leaseIds.includes(leaseId)) {
        this.gaveUp.delete(leaseId);
      }
    }
    if (this.owner === undefined || !leaseIds.includes(this.owner)) {
      this.choose();
    }
  }

  /** The owner cancelled or its login failed: the oldest lease that has not given up takes over. */
  ownerGaveUp(): void {
    if (this.owner !== undefined) {
      this.gaveUp.add(this.owner);
    }
    this.choose();
  }

  /** The login is over, for better or worse: ownership no longer changes. */
  finish(): void {
    this.finished = true;
  }

  private choose(): void {
    if (this.finished) {
      return;
    }
    const next = this.live.find(leaseId => !this.gaveUp.has(leaseId));
    if (next === this.owner) {
      return;
    }
    this.owner = next;
    if (next !== undefined) {
      this.onOwnerChanged(next);
    }
  }
}
