import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  clearAll,
  type HintStore,
  type SessionRecord,
} from '../../src/diagnostics/hint-store.ts';
import {hintStoreKeyOf} from '../../src/diagnostics/hint-store-key.ts';

/** A record that began at `started`, with no hint. */
function recordAt(started: string): SessionRecord {
  return {started, hints: []};
}

const ENVIRONMENT = {
  delay: () => Promise.resolve(),
  logger: createLogger(new MemorySink(), {minimumLevel: () => 'error'}),
};

/** A state that keeps what it is given, except the writes `reverts` says to revert, in turn. */
function stateOf(reverts: boolean[]) {
  const stored: {value?: HintStore} = {};
  const writes: HintStore[] = [];
  const pending = [...reverts];
  return {
    stored,
    writes,
    state: {
      get: () => stored.value,
      update: (key: string, value: HintStore) => {
        writes.push(value);
        if (!(pending.shift() ?? false)) {
          stored.value = value;
        }
        return Promise.resolve();
      },
    },
  };
}

describe('the hint store’s key over the global state (remote-oss/remote#2326)', () => {
  it('F-2605 BR-9 (c2326-one-key): the recorder and the clear command of a window share one key, so the read back of one never undoes the write of the other', () => {
    const {state} = stateOf([]);
    deepStrictEqual(
      hintStoreKeyOf(state, ENVIRONMENT) === hintStoreKeyOf(state, ENVIRONMENT),
      true,
    );
  });

  it('F-2605 AC-22 (c2326-clear-reverted): a clear that an older copy of the store reverts is written again, since a store written with no record is always the write’s own', async () => {
    const {state, stored, writes} = stateOf([true]);
    const key = hintStoreKeyOf(state, ENVIRONMENT);
    const cleared = clearAll('2026-11-02T00:00:09.000Z');
    await key.write(cleared);
    await key.verified();
    deepStrictEqual([writes.length, stored.value], [2, cleared]);
  });

  it('F-2605 BR-9 (c2326-two-windows): a record another window writes inside the read back is not erased by it, and a record that an older echo took out is put back beside the other window’s', async () => {
    const disk: {value?: HintStore} = {};
    const releases: Array<() => void> = [];
    function windowOver(echo: boolean) {
      let reverted = echo;
      let waited = false;
      return hintStoreKeyOf(
        {
          get: () => disk.value,
          update: (key: string, value: HintStore) => {
            if (reverted) {
              reverted = false;
            } else {
              disk.value = value;
            }
            return Promise.resolve();
          },
        },
        {
          // The first read back of each window waits until both have written.
          delay: () => {
            if (waited) {
              return Promise.resolve();
            }
            waited = true;
            return new Promise<void>(resolve => {
              releases.push(resolve);
            });
          },
          logger: ENVIRONMENT.logger,
        },
      );
    }
    const first = recordAt('2026-11-02T00:00:01.000Z');
    const second = recordAt('2026-11-02T00:00:02.000Z');
    const windowA = windowOver(true);
    const windowB = windowOver(false);
    await windowA.write({records: [first]});
    await windowB.write({records: [second]});
    for (const release of releases) {
      release();
    }
    await Promise.all([windowA.verified(), windowB.verified()]);
    deepStrictEqual(disk.value?.records.map(record => record.started).sort(), [
      first.started,
      second.started,
    ]);
  });
});
