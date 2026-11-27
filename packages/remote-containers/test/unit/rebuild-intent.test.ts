import {deepStrictEqual} from 'node:assert';
import {MemoryFiles} from 'lib-state/testing/memory-files';
import {
  REBUILD_INTENTS_KEY,
  storeRebuildIntent,
  takeRebuildIntent,
} from '../../src/open/rebuild-intent.ts';
import type {IntentMemento} from '../../src/state/timed-store.ts';
import {
  handoffFolderOf,
  rebuildHandoffsOn,
  writeRawHandoff,
} from './handoff-kinds.fixture.ts';

/** A memento that holds `initial`, which is what an earlier version kept. */
function earlierMemento(initial: unknown): IntentMemento {
  return {
    get: key => (key === REBUILD_INTENTS_KEY ? initial : undefined),
    update: () => Promise.resolve(),
  };
}

describe('the rebuild intent', () => {
  it('contracts §3: a stored intent is taken once, flattened, and its file is gone', async () => {
    const files = new MemoryFiles();
    const handoffs = rebuildHandoffsOn(files);
    await storeRebuildIntent(handoffs, 'first', {buildNoCache: true});
    const first = takeRebuildIntent(handoffs, 'first');
    const second = takeRebuildIntent(handoffs, 'first');
    deepStrictEqual(
      [first, second, files.names(handoffFolderOf('rebuild-intent'))],
      [
        {storedAt: 1000, removeExistingContainer: true, buildNoCache: true},
        undefined,
        [],
      ],
    );
  });

  it("contracts §3: an earlier version kept the intents under the extension's own key", () => {
    deepStrictEqual(
      REBUILD_INTENTS_KEY,
      'remote-oss.remote-containers.rebuildIntents',
    );
  });

  it('contracts §3: an entry of another shape is never taken, in a file or in the global state of an earlier version', () => {
    const files = new MemoryFiles();
    const handoffs = rebuildHandoffsOn(
      files,
      earlierMemento({
        first: {
          storedAt: 1000,
          value: {removeExistingContainer: false, buildNoCache: true},
        },
        second: {
          storedAt: 1000,
          value: {removeExistingContainer: true, buildNoCache: 'yes'},
        },
        third: {storedAt: 1000, value: null},
      }),
    );
    writeRawHandoff(
      files,
      'rebuild-intent',
      'fourth',
      JSON.stringify({storedAt: 1000, value: {buildNoCache: 3}}),
    );
    deepStrictEqual(
      ['first', 'second', 'third', 'fourth'].map(payload =>
        takeRebuildIntent(handoffs, payload),
      ),
      [undefined, undefined, undefined, undefined],
    );
  });

  it('contracts §3: an intent older than five minutes is dropped unread', async () => {
    const files = new MemoryFiles();
    const handoffs = rebuildHandoffsOn(files);
    await storeRebuildIntent(handoffs, 'first', {buildNoCache: false});
    files.clock += 300_001;
    deepStrictEqual(
      [
        takeRebuildIntent(handoffs, 'first'),
        files.names(handoffFolderOf('rebuild-intent')),
      ],
      [undefined, []],
    );
  });

  it('contracts §3: an intent that an earlier version kept in the global state is taken', () => {
    const handoffs = rebuildHandoffsOn(
      new MemoryFiles(),
      earlierMemento({
        first: {
          storedAt: 1000,
          value: {removeExistingContainer: true, buildNoCache: false},
        },
      }),
    );
    deepStrictEqual(takeRebuildIntent(handoffs, 'first'), {
      storedAt: 1000,
      removeExistingContainer: true,
      buildNoCache: false,
    });
  });

  it('contracts §3: the window that reloads leaves the intent, another window writes the global state from a stale copy, and the resolve after the reload still takes it; the control: the same intent in the global state is lost', async () => {
    const files = new MemoryFiles();
    await storeRebuildIntent(rebuildHandoffsOn(files), 'first', {
      buildNoCache: true,
    });
    const shared: {value: Record<string, unknown>} = {value: {}};
    const stale = {...shared.value};
    shared.value = {
      first: {
        storedAt: 1000,
        value: {removeExistingContainer: true, buildNoCache: true},
      },
    };
    shared.value = {...stale, other: 1};
    deepStrictEqual(
      [
        takeRebuildIntent(rebuildHandoffsOn(files), 'first')?.buildNoCache,
        shared.value.first,
      ],
      [true, undefined],
    );
  });

  it('contracts §3: two windows that connect at once to the same payload, one takes the intent', async () => {
    const files = new MemoryFiles();
    await storeRebuildIntent(rebuildHandoffsOn(files), 'first', {
      buildNoCache: false,
    });
    deepStrictEqual(
      [rebuildHandoffsOn(files), rebuildHandoffsOn(files)].map(
        window => takeRebuildIntent(window, 'first') !== undefined,
      ),
      [true, false],
    );
  });
});
