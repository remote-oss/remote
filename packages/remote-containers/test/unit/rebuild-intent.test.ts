import {deepStrictEqual} from 'node:assert';
import {
  REBUILD_INTENTS_KEY,
  storeRebuildIntent,
  takeRebuildIntent,
} from '../../src/open/rebuild-intent.ts';
import type {IntentMemento} from '../../src/state/timed-store.ts';

/** A memento that keeps what it is given. */
function mementoOf(): IntentMemento & {value: unknown} {
  const memento = {
    value: undefined as unknown,
    get: () => memento.value,
    update: (key: string, value: unknown) => {
      memento.value = value;
      return Promise.resolve();
    },
  };
  return memento;
}

describe('the rebuild intent', () => {
  it('contracts §3: a stored intent is taken once, flattened, and the map is empty after', async () => {
    const memento = mementoOf();
    await storeRebuildIntent(memento, 'p', {buildNoCache: true}, 1000);
    const first = await takeRebuildIntent(memento, 'p', 2000);
    const second = await takeRebuildIntent(memento, 'p', 2000);
    deepStrictEqual(
      [first, second, memento.value],
      [
        {at: 1000, removeExistingContainer: true, buildNoCache: true},
        undefined,
        {},
      ],
    );
  });

  it("contracts §3: the intent sits under the extension's own key", () => {
    deepStrictEqual(
      REBUILD_INTENTS_KEY,
      'remote-oss.remote-containers.rebuildIntents',
    );
  });

  it('contracts §3: an entry of another shape is never taken', async () => {
    const memento = mementoOf();
    memento.value = {
      p: {
        at: 1000,
        value: {removeExistingContainer: false, buildNoCache: true},
      },
      q: {
        at: 1000,
        value: {removeExistingContainer: true, buildNoCache: 'yes'},
      },
      r: {at: 1000, value: null},
    };
    deepStrictEqual(
      [
        await takeRebuildIntent(memento, 'p', 2000),
        await takeRebuildIntent(memento, 'q', 2000),
        await takeRebuildIntent(memento, 'r', 2000),
      ],
      [undefined, undefined, undefined],
    );
  });
});
