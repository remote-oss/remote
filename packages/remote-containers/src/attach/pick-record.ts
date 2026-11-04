/**
 * @fileoverview The attached containers the user picked, kept in the profile: the attach command and the row actions
 * record a target before they open its window, and the registration of the attached families connects to a target that
 * is not recorded only after the attach warning is confirmed.
 */

import {pinnedSettingsOf} from '../authority/payload.ts';
import {pickSetAdd, pickSetHas} from '../state/pick-set.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import type {AttachedTarget} from './payload.ts';

/** The key under which the profile keeps the targets that were picked. */
const ATTACH_PICKS_KEY = 'remote-oss.remote-containers.attachPicks';

/** The name of a picked container: its name and the engine coordinate its payload pins, not the working folder. */
export function attachPickKeyOf(target: AttachedTarget): string {
  return JSON.stringify([target.containerName, pinnedSettingsOf(target)]);
}

/** Whether the target named `key` was picked. */
export function attachPicked(memento: IntentMemento, key: string): boolean {
  return pickSetHas(memento, ATTACH_PICKS_KEY, key);
}

/** Adds the target named `key` to the picked ones. */
export function recordAttachPick(
  memento: IntentMemento,
  key: string,
): Promise<void> {
  return pickSetAdd(memento, ATTACH_PICKS_KEY, key);
}
