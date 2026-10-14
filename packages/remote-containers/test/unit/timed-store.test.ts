import {deepStrictEqual} from 'node:assert';
import {
  type IntentMemento,
  storeTimedEntry,
  takeTimedEntry,
  TIMED_ENTRY_MILLISECONDS,
} from '../../src/state/timed-store.ts';

const MAP_KEY = 'test.timedEntries';

/** A memento holding one value under `KEY`, recording each update. */
class FakeMemento implements IntentMemento {
  value: unknown;
  readonly updates: unknown[] = [];
  failsToUpdate = false;

  constructor(value?: unknown) {
    this.value = value;
  }

  get(): unknown {
    return this.value;
  }

  update(key: string, value: unknown): Promise<void> {
    if (this.failsToUpdate) {
      return Promise.reject(new Error('disk full'));
    }
    this.updates.push(value);
    this.value = value;
    return Promise.resolve();
  }
}

/** A guard for values that are numbers. */
function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

describe('the timed store', () => {
  it('contracts §3: a stored entry is taken once, and the map is empty after the first take', async () => {
    const memento = new FakeMemento();
    await storeTimedEntry(memento, MAP_KEY, 'first', 7, 1000);
    const first = await takeTimedEntry(
      memento,
      MAP_KEY,
      'first',
      2000,
      isNumber,
    );
    const second = await takeTimedEntry(
      memento,
      MAP_KEY,
      'first',
      2000,
      isNumber,
    );
    deepStrictEqual(
      [first, second, memento.value],
      [{storedAt: 1000, value: 7}, undefined, {}],
    );
  });

  it('contracts §3: an entry older than five minutes is cleared unused', async () => {
    const memento = new FakeMemento();
    await storeTimedEntry(memento, MAP_KEY, 'first', 7, 0);
    const taken = await takeTimedEntry(
      memento,
      MAP_KEY,
      'first',
      TIMED_ENTRY_MILLISECONDS + 1,
      isNumber,
    );
    deepStrictEqual([taken, memento.value], [undefined, {}]);
  });

  it('contracts §3: an entry exactly five minutes old is still taken', async () => {
    const memento = new FakeMemento();
    await storeTimedEntry(memento, MAP_KEY, 'first', 7, 0);
    deepStrictEqual(
      await takeTimedEntry(
        memento,
        MAP_KEY,
        'first',
        TIMED_ENTRY_MILLISECONDS,
        isNumber,
      ),
      {storedAt: 0, value: 7},
    );
  });

  it('contracts §3: a clock that went back drops the entry', async () => {
    const memento = new FakeMemento();
    await storeTimedEntry(memento, MAP_KEY, 'first', 7, 5000);
    deepStrictEqual(
      await takeTimedEntry(memento, MAP_KEY, 'first', 4000, isNumber),
      undefined,
    );
  });

  it('contracts §3: taking one entry keeps the others', async () => {
    const memento = new FakeMemento();
    await storeTimedEntry(memento, MAP_KEY, 'other', 1, 1000);
    await storeTimedEntry(memento, MAP_KEY, 'second', 2, 1000);
    await takeTimedEntry(memento, MAP_KEY, 'other', 2000, isNumber);
    deepStrictEqual(memento.value, {second: {storedAt: 1000, value: 2}});
  });

  it('contracts §3: storing drops the stale entries of other ids', async () => {
    const memento = new FakeMemento({stale: {storedAt: 0, value: 1}});
    await storeTimedEntry(memento, MAP_KEY, 'fresh', 2, 400000);
    deepStrictEqual(memento.value, {fresh: {storedAt: 400000, value: 2}});
  });

  it('contracts §3: a store that is not a map counts as empty and is written back as one', async () => {
    const written = [];
    for (const stored of ['x', [], {first: {storedAt: 'n', value: 1}}]) {
      const memento = new FakeMemento(stored);
      await takeTimedEntry(memento, MAP_KEY, 'first', 1000, isNumber);
      written.push(memento.updates);
    }
    deepStrictEqual(written, [[{}], [{}], [{}]]);
  });

  it('contracts §3: an entry whose value fails the guard is dropped', async () => {
    const memento = new FakeMemento({first: {storedAt: 1000, value: 'text'}});
    const taken = await takeTimedEntry(
      memento,
      MAP_KEY,
      'first',
      2000,
      isNumber,
    );
    deepStrictEqual([taken, memento.value], [undefined, {}]);
  });

  it('contracts §3: nothing to take writes nothing', async () => {
    const empty = new FakeMemento({});
    const missing = new FakeMemento();
    await takeTimedEntry(empty, MAP_KEY, 'first', 1000, isNumber);
    await takeTimedEntry(missing, MAP_KEY, 'first', 1000, isNumber);
    deepStrictEqual([empty.updates, missing.updates], [[], []]);
  });

  it('contracts §3: a failed update rejects to the caller, on store and on take', async () => {
    const memento = new FakeMemento({first: {storedAt: 1000, value: 1}});
    memento.failsToUpdate = true;
    const outcomes = await Promise.allSettled([
      storeTimedEntry(memento, MAP_KEY, 'other', 2, 1000),
      takeTimedEntry(memento, MAP_KEY, 'first', 1000, isNumber),
    ]);
    deepStrictEqual(
      outcomes.map(outcome =>
        outcome.status === 'rejected' ? (outcome.reason as Error).message : '',
      ),
      ['disk full', 'disk full'],
    );
  });
});
