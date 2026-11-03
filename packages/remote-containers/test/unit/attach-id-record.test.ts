import {deepStrictEqual} from 'node:assert';
import {ATTACHED_IDS_KEY, idRecordOf} from '../../src/attach/id-record.ts';

/** A memento over an object, with what was written. */
function mementoOf(initial: Record<string, unknown>) {
  const values = {...initial};
  return {
    values,
    get: (key: string): unknown => values[key],
    update: (key: string, value: unknown): Promise<void> => {
      values[key] = value;
      return Promise.resolve();
    },
  };
}

const FIRST = 'aa';
const SECOND = 'bb';
const THIRD = 'cc';

describe('the id record of attached containers (card containers-163, step 13)', () => {
  it('F-0601 AC-61: an id written for a payload is read back for it and for no other, and a second write keeps the first', async () => {
    const memento = mementoOf({});
    const record = idRecordOf(memento);
    await record.write(FIRST, 'id1');
    await record.write(SECOND, 'id2');
    await record.write(FIRST, 'id3');
    deepStrictEqual(
      [record.read(FIRST), record.read(SECOND), record.read(THIRD)],
      ['id3', 'id2', undefined],
    );
  });

  it('F-0601 AC-61: a stored value that is not a map of text is no record, and a write replaces it by one', async () => {
    const memento = mementoOf({[ATTACHED_IDS_KEY]: ['x']});
    const record = idRecordOf(memento);
    const before = record.read(FIRST);
    await record.write(FIRST, 'id1');
    const mixed = mementoOf({
      [ATTACHED_IDS_KEY]: {[FIRST]: 7, [SECOND]: 'id2'},
    });
    deepStrictEqual(
      [
        before,
        memento.values[ATTACHED_IDS_KEY],
        idRecordOf(mixed).read(FIRST),
        idRecordOf(mixed).read(SECOND),
      ],
      [undefined, {[FIRST]: 'id1'}, undefined, 'id2'],
    );
  });
});
