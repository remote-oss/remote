/**
 * @fileoverview The hint store's key of the extension's global state, written and read back: the recorder and the clear
 * command of a window write through one object, so that the read back of one never undoes the write of the other
 * (remote-oss/remote#2326).
 */

import {
  confirmedKeyOf,
  type ConfirmedKey,
  type ConfirmedState,
  type ConfirmedUpdateEnvironment,
} from '../state/confirmed-update.ts';
import {
  HINT_STORE_KEY,
  type HintStore,
  isGone,
  storeHolds,
  storeMerged,
} from './hint-store.ts';

/** The keys already made, by the state they write to. */
const KEYS = new WeakMap<object, ConfirmedKey<HintStore>>();

/** The hint store's key over `state`; the same object for the same state. */
export function hintStoreKeyOf(
  state: ConfirmedState<HintStore>,
  environment: ConfirmedUpdateEnvironment,
): ConfirmedKey<HintStore> {
  const known = KEYS.get(state);
  if (known !== undefined) {
    return known;
  }
  const made = confirmedKeyOf(state, HINT_STORE_KEY, environment, {
    // Another window writes records into the same store: a write is read back for its own record, and put back into
    // what is read, so that the other window's record is not erased.
    holds: storeHolds,
    merge: storeMerged,
    // A store that differs from the last write is put back unless the difference is on purpose: the store was cleared
    // after the newest record began, or it holds two newer records. A missing record otherwise is an older copy's.
    ownedWhenRead: (read, latest, own) =>
      own === undefined || !isGone(read, own),
  });
  KEYS.set(state, made);
  return made;
}
