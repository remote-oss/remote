/**
 * @fileoverview How many times one source may ask GitHub about tokens that are in no cache: ten in a minute, counted in
 * a fixed window that starts at the source's first lookup. Past that, the source is told how long to wait. A source is
 * an IPv4 address, an IPv4-mapped IPv6 address as its IPv4 address, and any other IPv6 address as its /64 prefix: the
 * prefix is the smallest network an operator hands out, and one host holds all of its addresses.
 */

/** The most lookups one source may make in a window. */
export const LOOKUPS_MOST = 10;

/** How long a window lasts, in milliseconds. */
export const LOOKUP_WINDOW = 60 * 1000;

/**
 * The most sources held. The windows are kept in the order they started: those that have ended are dropped from the
 * oldest on, and when every window held is still running, the one that started first is dropped to keep the count, so a
 * source that has used its lookups is forgotten only after ten thousand others have started a window since.
 */
export const SOURCES_MOST = 10_000;

/** What taking a lookup gave: leave to go on, or the seconds to wait. */
export type Taken =
  {kind: 'allowed'} | {kind: 'refused'; retryAfterSeconds: number};

/** The eight 16-bit groups of IPv6 address `address`, which may name its last 32 bits as an IPv4 address. */
function groupsOf(address: string): number[] {
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  const text =
    dotted === null
      ? address
      : `${address.slice(0, dotted.index)}${(
          (Number(dotted[1]) << 8) |
          Number(dotted[2])
        ).toString(
          16,
        )}:${((Number(dotted[3]) << 8) | Number(dotted[4])).toString(16)}`;
  const [head, tail] = text.split('::') as [string, string | undefined];
  const front = head === '' ? [] : head.split(':');
  const back = tail === undefined || tail === '' ? [] : tail.split(':');
  const zeros = tail === undefined ? 0 : 8 - front.length - back.length;
  return [...front, ...Array<string>(zeros).fill('0'), ...back].map(group =>
    parseInt(group, 16),
  );
}

/** The source that `address` counts as: see the file's description. */
function sourceOf(address: string): string {
  if (!address.includes(':')) {
    return address;
  }
  const groups = groupsOf(address);
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const [high, rest] = groups.slice(6) as [number, number];
    return `${String(high >> 8)}.${String(high & 0xff)}.${String(rest >> 8)}.${String(rest & 0xff)}`;
  }
  return groups
    .slice(0, 4)
    .map(group => group.toString(16))
    .join(':');
}

/** The lookups each source has made in its current window. */
export class LookupLimit {
  private readonly now: () => number;
  private readonly windows: Map<string, {start: number; count: number}>;

  /** Counts at the times `now` gives in milliseconds, in `windows`, which is empty. */
  constructor(
    now: () => number,
    windows = new Map<string, {start: number; count: number}>(),
  ) {
    this.now = now;
    this.windows = windows;
  }

  /** How many sources have a window held. */
  get held(): number {
    return this.windows.size;
  }

  /** Counts one lookup of `address`, or refuses it when its source has made its ten in the window. */
  take(address: string): Taken {
    const now = this.now();
    this.dropEnded(now);
    const source = sourceOf(address);
    const window = this.windows.get(source);
    if (window === undefined) {
      if (this.windows.size >= SOURCES_MOST) {
        for (const oldest of this.windows.keys()) {
          this.windows.delete(oldest);
          break;
        }
      }
      this.windows.set(source, {start: now, count: 1});
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

  /** The window that started first, with its source. */
  private oldest(): [string, {start: number; count: number}] | undefined {
    return this.windows.entries().next().value;
  }

  /** Drops the windows that have ended, oldest first, which are all of them: the order is the order they started. */
  private dropEnded(now: number): void {
    for (
      let first = this.oldest();
      first !== undefined && first[1].start + LOOKUP_WINDOW <= now;
      first = this.oldest()
    ) {
      this.windows.delete(first[0]);
    }
  }
}
