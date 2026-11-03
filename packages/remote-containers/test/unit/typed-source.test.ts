import {deepStrictEqual} from 'node:assert';
import {
  clearTypedSource,
  storeTypedSource,
  TYPED_SOURCE_MILLISECONDS,
  typedSourceRecorded,
} from '../../src/volumes/typed-source.ts';
import {mementoOf} from './fake-memento.ts';

const ONE_DAY = TYPED_SOURCE_MILLISECONDS;

describe('the record of a typed source (card containers-151)', () => {
  it('a recorded payload reads as typed for a day, and every other payload as from a link', async () => {
    const memento = mementoOf();
    await storeTypedSource(memento, 'aa', 1000);
    deepStrictEqual(
      [
        typedSourceRecorded(memento, 'aa', 1000 + ONE_DAY),
        typedSourceRecorded(memento, 'aa', 1001 + ONE_DAY),
        typedSourceRecorded(memento, 'bb', 1000),
        typedSourceRecorded(memento, 'aa', 999),
      ],
      [true, false, false, false],
    );
  });

  it('a read writes nothing, so a retry reads the same; a successful clone clears the record', async () => {
    const memento = mementoOf();
    await storeTypedSource(memento, 'aa', 0);
    const before = memento.value;
    const firstRead = typedSourceRecorded(memento, 'aa', 10);
    const secondRead = typedSourceRecorded(memento, 'aa', 20);
    const unchanged = memento.value === before;
    await clearTypedSource(memento, 'aa', 30);
    deepStrictEqual(
      [
        firstRead,
        secondRead,
        unchanged,
        typedSourceRecorded(memento, 'aa', 40),
      ],
      [true, true, true, false],
    );
  });

  it('a write drops the records older than a day, and a value that isn’t ours reads as none', async () => {
    const memento = mementoOf();
    await storeTypedSource(memento, 'old', 0);
    await storeTypedSource(memento, 'new', ONE_DAY + 1);
    const kept = Object.keys(memento.value as object);
    memento.value = {forged: {storedAt: 0, value: 'yes'}};
    deepStrictEqual(
      [kept, typedSourceRecorded(memento, 'forged', 0)],
      [['new'], false],
    );
  });
});
