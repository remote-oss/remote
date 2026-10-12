/**
 * @fileoverview The record of the licence terms the user has accepted: one entry per terms page in the extension's
 * global state, which belongs to the profile and is never synced.
 */

import type {AcceptanceStore} from 'lib-server';

/** The part of the editor's state memento the record uses. */
export interface AcceptanceState {
  get(stateKey: string): unknown;
  update(stateKey: string, value: unknown): PromiseLike<void>;
}

/** The record over `state`: accepted only when the stored value is exactly `true`. */
export function acceptanceStoreOf(state: AcceptanceState): AcceptanceStore {
  return {
    isAccepted: storeKey => state.get(storeKey) === true,
    accept: async storeKey => {
      await state.update(storeKey, true);
    },
  };
}
