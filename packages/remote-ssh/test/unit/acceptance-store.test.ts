import {deepStrictEqual} from 'node:assert';
import {acceptanceStoreOf} from '../../src/surfaces/acceptance-store.ts';

function memory(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const updates: Array<[string, unknown]> = [];
  return {
    updates,
    state: {
      get: (stateKey: string) => values.get(stateKey),
      update: (stateKey: string, value: unknown) => {
        updates.push([stateKey, value]);
        values.set(stateKey, value);
        return Promise.resolve();
      },
    },
  };
}

describe('the record of accepted licence terms (F-3902 rule 11)', () => {
  it('F-3902 rule 11: nothing stored is not accepted', () => {
    deepStrictEqual(acceptanceStoreOf(memory().state).isAccepted('k'), false);
  });

  it('F-3902 rule 11: a stored true is accepted', () => {
    deepStrictEqual(
      acceptanceStoreOf(memory({k: true}).state).isAccepted('k'),
      true,
    );
  });

  it('F-3902 rule 11: any other stored value is not accepted', () => {
    deepStrictEqual(
      acceptanceStoreOf(memory({k: 'yes'}).state).isAccepted('k'),
      false,
    );
  });

  it('F-3902 rule 11: accepting stores true once, and then the key is accepted', async () => {
    const {state, updates} = memory();
    const store = acceptanceStoreOf(state);
    await store.accept('k');
    deepStrictEqual([updates, store.isAccepted('k')], [[['k', true]], true]);
  });
});
