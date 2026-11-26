import {deepStrictEqual} from 'node:assert';
import {
  LOOKUP_WINDOW,
  LookupLimit,
  LOOKUPS_MOST,
} from '../../src/auth/lookups.ts';

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

  it('drops the windows that have ended once a thousand addresses are held, and keeps the ones that have not', () => {
    const clock = {now: 1_000_000};
    const limit = limitAt(clock);
    for (let index = 0; index < 999; index += 1) {
      limit.take(`old-${String(index)}`);
    }
    clock.now = 1_000_000 + LOOKUP_WINDOW - 1;
    limit.take('late');
    const before = limit.held;
    clock.now = 1_000_000 + LOOKUP_WINDOW;
    // The next address finds a thousand held: the 999 that ended go, `late` (started a moment before) stays.
    limit.take('new');
    deepStrictEqual([before, limit.held], [1000, 2]);
  });
});
