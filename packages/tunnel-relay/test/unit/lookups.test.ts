import {deepStrictEqual} from 'node:assert';
import {
  LOOKUP_WINDOW,
  LookupLimit,
  LOOKUPS_MOST,
  SOURCES_MOST,
} from '../../src/auth/lookups.ts';

/** The window a limit keeps for a source. */
interface Window {
  start: number;
  count: number;
}

/** Windows that count how far their iterators were stepped, which is what a scan of them costs. */
function countingWindows(): {
  windows: Map<string, Window>;
  steps: () => number;
} {
  const windows = new Map<string, Window>();
  const entries = windows.entries.bind(windows);
  let steps = 0;
  windows.entries = () => {
    const iterator = entries();
    const counting = {
      next: () => {
        steps += 1;
        return iterator.next();
      },
      [Symbol.iterator]: () => counting,
    };
    return counting as never;
  };
  return {windows, steps: () => steps};
}

/** A limit over a clock the row sets, in milliseconds. */
function limitAt(clock: {now: number}): LookupLimit {
  return new LookupLimit(() => clock.now);
}

/** What `count` lookups of `address` gave, in order. */
function takes(limit: LookupLimit, address: string, count: number) {
  return Array.from({length: count}, () => limit.take(address));
}

describe('the lookup limit of one address', () => {
  it('allows ten lookups in a window and refuses the eleventh with the whole window to wait', () => {
    const clock = {now: 1_000_000};
    const limit = limitAt(clock);
    const given = takes(limit, '10.0.0.1', LOOKUPS_MOST + 1);
    deepStrictEqual(
      [
        given.slice(0, LOOKUPS_MOST).every(each => each.kind === 'allowed'),
        given.at(-1),
      ],
      [true, {kind: 'refused', retryAfterSeconds: 60}],
    );
  });

  it('counts down the seconds to wait within the window, rounding up', () => {
    const clock = {now: 1_000_000};
    const limit = limitAt(clock);
    takes(limit, '10.0.0.1', LOOKUPS_MOST);
    const waits = [1, 20_001, 59_999].map(elapsed => {
      clock.now = 1_000_000 + elapsed;
      return limit.take('10.0.0.1');
    });
    deepStrictEqual(waits, [
      {kind: 'refused', retryAfterSeconds: 60},
      {kind: 'refused', retryAfterSeconds: 40},
      {kind: 'refused', retryAfterSeconds: 1},
    ]);
  });

  it('starts a new window at the end of the old one, and not a moment before', () => {
    const clock = {now: 1_000_000};
    const limit = limitAt(clock);
    takes(limit, '10.0.0.1', LOOKUPS_MOST);
    clock.now = 1_000_000 + LOOKUP_WINDOW - 1;
    const before = limit.take('10.0.0.1');
    clock.now = 1_000_000 + LOOKUP_WINDOW;
    const after = takes(limit, '10.0.0.1', LOOKUPS_MOST + 1);
    deepStrictEqual(
      [
        before.kind,
        after.slice(0, LOOKUPS_MOST).every(each => each.kind === 'allowed'),
        after.at(-1)?.kind,
      ],
      ['refused', true, 'refused'],
    );
  });

  it('counts each address on its own', () => {
    const clock = {now: 1_000_000};
    const limit = limitAt(clock);
    takes(limit, '10.0.0.1', LOOKUPS_MOST);
    deepStrictEqual(
      [limit.take('10.0.0.1').kind, limit.take('10.0.0.2').kind],
      ['refused', 'allowed'],
    );
  });

  it('drops the windows that have ended, and keeps the ones that have not, and a source that starts again is held once', () => {
    const clock = {now: 1_000_000};
    const limit = limitAt(clock);
    limit.take('first');
    clock.now += 10_000;
    limit.take('second');
    clock.now = 1_000_000 + LOOKUP_WINDOW;
    // `first` has ended and starts again behind `second`, which is still running.
    limit.take('first');
    const held = [limit.held];
    clock.now = 1_000_000 + LOOKUP_WINDOW + 10_000;
    limit.take('third');
    // `second` has ended now; `first` (started at the first instant) and `third` are running.
    held.push(limit.held);
    deepStrictEqual(held, [2, 2]);
  });

  it('holds at most ten thousand sources however many ask, at a cost that does not grow with the number held', () => {
    const clock = {now: 1_000_000};
    const counted = countingWindows();
    const limit = new LookupLimit(() => clock.now, counted.windows);
    const asking = 4 * SOURCES_MOST;
    for (let index = 0; index < asking; index += 1) {
      limit.take(
        `10.${String(index >> 16)}.${String((index >> 8) & 255)}.${String(index & 255)}`,
      );
    }
    deepStrictEqual(
      [limit.held, counted.steps() <= 3 * asking],
      [SOURCES_MOST, true],
    );
  });

  it('drops the source whose window started first when every window held is running, and no other', () => {
    const clock = {now: 1_000_000};
    const limit = limitAt(clock);
    takes(limit, 'first', LOOKUPS_MOST);
    clock.now += 1;
    takes(limit, 'second', LOOKUPS_MOST);
    for (let index = 0; index < SOURCES_MOST - 2; index += 1) {
      limit.take(`other-${String(index)}`);
    }
    const full = limit.held;
    limit.take('extra');
    // `second` is asked first: `first` would start a window of its own and drop the oldest, which is `second`.
    const second = limit.take('second').kind;
    deepStrictEqual(
      [full, limit.held, second, limit.take('first').kind],
      [SOURCES_MOST, SOURCES_MOST, 'refused', 'allowed'],
    );
  });
});

describe('the source that an address counts as', () => {
  /** Whether `later` is refused after `earlier` has made all ten of its lookups. */
  function sharedBetween(earlier: string, later: string): boolean {
    const limit = limitAt({now: 1_000_000});
    takes(limit, earlier, LOOKUPS_MOST);
    return limit.take(later).kind === 'refused';
  }

  it('is one for all addresses of an IPv6 /64, however they are written', () => {
    deepStrictEqual(
      [
        sharedBetween('2001:db8:1:2::1', '2001:db8:1:2:aaaa:bbbb:cccc:dddd'),
        sharedBetween('2001:db8:1:2::1', '2001:DB8:1:2:0:0:0:5'),
        sharedBetween('2001:db8:1:2:3:4:5:6', '2001:db8:1:2:7:8:9:a'),
        sharedBetween('fe80::1%eth0', 'fe80::2%eth1'),
        sharedBetween('2001:db8:1:2::', '2001:db8:1:2::9'),
        sharedBetween('::1', '::2'),
      ],
      [true, true, true, true, true, true],
    );
  });

  it('differs between two /64 prefixes, and between an IPv6 address and an IPv4 one', () => {
    deepStrictEqual(
      [
        sharedBetween('2001:db8:1:2::1', '2001:db8:1:3::1'),
        sharedBetween('2001:db8:1:2::1', '2001:db8:2:2::1'),
        sharedBetween('2001:db8:1:2::1', '10.0.0.1'),
        sharedBetween('10.0.0.1', '10.0.0.2'),
        sharedBetween('::1', '::ffff:0:1'),
      ],
      [false, false, false, false, false],
    );
  });

  it('is the IPv4 address for an IPv4-mapped IPv6 address, in either form', () => {
    deepStrictEqual(
      [
        sharedBetween('10.0.0.1', '::ffff:10.0.0.1'),
        sharedBetween('::ffff:10.0.0.1', '10.0.0.1'),
        sharedBetween('::ffff:10.0.0.1', '::ffff:a00:1'),
        sharedBetween('10.1.2.3', '::FFFF:a01:203'),
        sharedBetween('10.0.0.1', '::ffff:10.0.0.2'),
      ],
      [true, true, true, true, false],
    );
  });

  it('is the address itself when it is neither, as the empty address of a socket with none', () => {
    deepStrictEqual(
      [sharedBetween('', ''), sharedBetween('', 'unknown')],
      [true, false],
    );
  });
});
