/**
 * @fileoverview The volumes whose recovery the user asked for in a failing Clone in Volume window. The profile keeps
 * their names, and a recovery window opens only on a volume in the set, so a crafted link can't have the editor mount a
 * volume that no clone of the user's named.
 */

import type {IntentMemento} from '../state/timed-store.ts';

/** The key under which the profile keeps the names of the volumes whose recovery was asked for. */
export const RECOVERY_VOLUMES_KEY =
  'remote-oss.remote-containers.recoveryVolumes';

/** The names kept under the key: the strings of the stored value, none for a value of another shape. */
function namesOf(stored: unknown): string[] {
  return Array.isArray(stored)
    ? stored.filter((each): each is string => typeof each === 'string')
    : [];
}

/** Whether the recovery of `volumeName` was asked for. */
export function recoveryPicked(
  memento: IntentMemento,
  volumeName: string,
): boolean {
  return namesOf(memento.get(RECOVERY_VOLUMES_KEY)).includes(volumeName);
}

/** Adds `volumeName` to the set; a name that is in it already is not added again. */
export async function recordRecoveryPick(
  memento: IntentMemento,
  volumeName: string,
): Promise<void> {
  const names = namesOf(memento.get(RECOVERY_VOLUMES_KEY));
  if (!names.includes(volumeName)) {
    await memento.update(RECOVERY_VOLUMES_KEY, [...names, volumeName]);
  }
}
