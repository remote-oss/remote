import {deepStrictEqual} from 'node:assert';
import {
  REBUILD_INTENTS_KEY,
  storeRebuildIntent,
  takeRebuildIntent,
} from '../../src/open/rebuild-intent.ts';
import {mementoOf} from './fake-memento.ts';

describe('the rebuild intent', () => {
  it('contracts §3: a stored intent is taken once, flattened, and the map is empty after', async () => {
    const memento = mementoOf();
    await storeRebuildIntent(memento, 'first', {buildNoCache: true}, 1000);
    const first = await takeRebuildIntent(memento, 'first', 2000);
    const second = await takeRebuildIntent(memento, 'first', 2000);
    deepStrictEqual(
      [first, second, memento.value],
      [
        {storedAt: 1000, removeExistingContainer: true, buildNoCache: true},
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
      first: {
        storedAt: 1000,
        value: {removeExistingContainer: false, buildNoCache: true},
      },
      second: {
        storedAt: 1000,
        value: {removeExistingContainer: true, buildNoCache: 'yes'},
      },
      third: {storedAt: 1000, value: null},
    };
    deepStrictEqual(
      [
        await takeRebuildIntent(memento, 'first', 2000),
        await takeRebuildIntent(memento, 'second', 2000),
        await takeRebuildIntent(memento, 'third', 2000),
      ],
      [undefined, undefined, undefined],
    );
  });
});
