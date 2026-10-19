import type {IntentMemento} from '../../src/state/timed-store.ts';

/** A memento that keeps what it is given, whatever the key. */
export function mementoOf(): IntentMemento & {value: unknown} {
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
