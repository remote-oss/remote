/**
 * @fileoverview How many times one source address may ask GitHub about tokens that are in no cache: ten in a minute,
 * counted in a fixed window that starts at the address's first lookup. Past that, the address is told how long to wait.
 */

/** The most lookups one address may make in a window. */
export const LOOKUPS_MOST = 10;

/** How long a window lasts, in milliseconds. */
export const LOOKUP_WINDOW = 60 * 1000;

/** How many addresses are held before the windows that have ended are dropped. */
const ADDRESSES_MOST = 1000;

/** What taking a lookup gave: leave to go on, or the seconds to wait. */
export type Taken =
  {kind: 'allowed'} | {kind: 'refused'; retryAfterSeconds: number};

/** The lookups each address has made in its current window. */
export class LookupLimit {
  private readonly now: () => number;
  private readonly windows = new Map<string, {start: number; count: number}>();

  /** Counts at the times `now` gives in milliseconds. */
  constructor(now: () => number) {
    this.now = now;
  }

  /** How many addresses have a window held. */
  get held(): number {
    return this.windows.size;
  }

  /** Counts one lookup of `address`, or refuses it when the address has made its ten in the window. */
  take(address: string): Taken {
    const now = this.now();
    if (this.windows.size >= ADDRESSES_MOST) {
      for (const [other, held] of this.windows) {
        if (held.start + LOOKUP_WINDOW <= now) {
          this.windows.delete(other);
        }
      }
    }
    const window = this.windows.get(address);
    if (window === undefined || window.start + LOOKUP_WINDOW <= now) {
      this.windows.set(address, {start: now, count: 1});
      return {kind: 'allowed'};
    }
    if (window.count >= LOOKUPS_MOST) {
      return {
        kind: 'refused',
        retryAfterSeconds: Math.ceil(
          (window.start + LOOKUP_WINDOW - now) / 1000,
        ),
      };
    }
    window.count += 1;
    return {kind: 'allowed'};
  }
}
