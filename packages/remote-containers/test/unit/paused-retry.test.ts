import {deepStrictEqual} from 'node:assert';
import {
  PAUSED_RETRIES_KEY,
  storePausedRetry,
  takePausedRetry,
} from '../../src/state/paused-retry.ts';
import {TIMED_ENTRY_MILLISECONDS} from '../../src/state/timed-store.ts';
import {mementoOf} from './fake-memento.ts';

const FIRST = 'a'.repeat(64);
const SECOND = 'b'.repeat(64);

describe('the paused retry (card containers-47)', () => {
  it("F-0409 ruling 12: the retry sits under the extension's own key", () => {
    deepStrictEqual(
      PAUSED_RETRIES_KEY,
      'remote-oss.remote-containers.pausedRetries',
    );
  });

  it('F-0409 ruling 12: a stored retry is taken once, for its own container only, and the map is empty after', async () => {
    const memento = mementoOf();
    await storePausedRetry(memento, FIRST, 1000);
    const other = await takePausedRetry(memento, SECOND, 2000);
    const first = await takePausedRetry(memento, FIRST, 2000);
    const again = await takePausedRetry(memento, FIRST, 2000);
    deepStrictEqual(
      [other, first, again, memento.value],
      [false, true, false, {}],
    );
  });

  it('F-0409 ruling 12: a retry older than five minutes is not taken', async () => {
    const memento = mementoOf();
    await storePausedRetry(memento, FIRST, 1000);
    deepStrictEqual(
      await takePausedRetry(
        memento,
        FIRST,
        1000 + TIMED_ENTRY_MILLISECONDS + 1,
      ),
      false,
    );
  });

  it('F-0409 ruling 12: an entry of another shape is never taken', async () => {
    const memento = mementoOf();
    memento.value = {[FIRST]: {storedAt: 1000, value: 'yes'}};
    deepStrictEqual(await takePausedRetry(memento, FIRST, 2000), false);
  });
});
