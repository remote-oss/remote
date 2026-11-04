/**
 * @fileoverview The volumes whose recovery the user asked for in a failing Clone in Volume window. The profile keeps
 * their names, and a recovery window opens only on a volume in the set, so a crafted link can't have the editor mount a
 * volume that no clone of the user's named.
 */

import {pickSetAdd, pickSetHas} from '../state/pick-set.ts';
import type {IntentMemento} from '../state/timed-store.ts';

/** The key under which the profile keeps the names of the volumes whose recovery was asked for. */
const RECOVERY_VOLUMES_KEY = 'remote-oss.remote-containers.recoveryVolumes';

/** Whether the recovery of `volumeName` was asked for. */
export function recoveryPicked(
  memento: IntentMemento,
  volumeName: string,
): boolean {
  return pickSetHas(memento, RECOVERY_VOLUMES_KEY, volumeName);
}

/** Adds `volumeName` to the set; a name that is in it already is not added again. */
export function recordRecoveryPick(
  memento: IntentMemento,
  volumeName: string,
): Promise<void> {
  return pickSetAdd(memento, RECOVERY_VOLUMES_KEY, volumeName);
}
