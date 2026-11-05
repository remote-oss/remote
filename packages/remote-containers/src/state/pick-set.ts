/**
 * @fileoverview A set of names the profile keeps under a key of ours: what the user picked, so that a window that comes
 * from a link or an old recent entry can be told from one the user asked for.
 */

import type {IntentMemento} from './timed-store.ts';

/** The names kept under `key`: the strings of the stored value, none for a value of another shape. */
function namesOf(memento: IntentMemento, key: string): string[] {
  const stored = memento.get(key);
  return Array.isArray(stored)
    ? stored.filter((each): each is string => typeof each === 'string')
    : [];
}

/** Whether `name` is in the set kept under `key`. */
export function pickSetHas(
  memento: IntentMemento,
  key: string,
  name: string,
): boolean {
  return namesOf(memento, key).includes(name);
}

/** Adds `name` to the set kept under `key`; a name that is in it already is not added again. */
export async function pickSetAdd(
  memento: IntentMemento,
  key: string,
  name: string,
): Promise<void> {
  const names = namesOf(memento, key);
  if (!names.includes(name)) {
    await memento.update(key, [...names, name]);
  }
}
