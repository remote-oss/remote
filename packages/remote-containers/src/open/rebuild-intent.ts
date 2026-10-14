/**
 * @fileoverview The rebuild intent: what a window leaves for the resolve that follows its reload, so that the next
 * connect removes and builds the container again. It lives in the extension's own `globalState`, never synced, and
 * expires after five minutes.
 */

import {
  type IntentMemento,
  storeTimedEntry,
  takeTimedEntry,
} from '../state/timed-store.ts';

/** The extension's own key in `globalState`; never synced. */
export const REBUILD_INTENTS_KEY =
  'remote-oss.remote-containers.rebuildIntents';

/** What a rebuild command asks for beyond removing the container. */
export interface RebuildOptions {
  buildNoCache: boolean;
}

/** A taken intent: when it was stored, and what it asks. */
export interface RebuildIntent {
  at: number;
  removeExistingContainer: true;
  buildNoCache: boolean;
}

/** The shape a stored intent has. */
function isIntentValue(
  value: unknown,
): value is {removeExistingContainer: true; buildNoCache: boolean} {
  const record = value as Record<string, unknown> | null;
  return (
    typeof record === 'object' &&
    record !== null &&
    record.removeExistingContainer === true &&
    typeof record.buildNoCache === 'boolean'
  );
}

/** Leaves an intent for `payload`, the authority's payload of the window that will reload. */
export function storeRebuildIntent(
  memento: IntentMemento,
  payload: string,
  options: RebuildOptions,
  now: number,
): Promise<void> {
  return storeTimedEntry(
    memento,
    REBUILD_INTENTS_KEY,
    payload,
    {
      removeExistingContainer: true,
      buildNoCache: options.buildNoCache,
    },
    now,
  );
}

/** Takes the intent for `payload` once; none when there was none or it expired. */
export async function takeRebuildIntent(
  memento: IntentMemento,
  payload: string,
  now: number,
): Promise<RebuildIntent | undefined> {
  const entry = await takeTimedEntry(
    memento,
    REBUILD_INTENTS_KEY,
    payload,
    now,
    isIntentValue,
  );
  return entry === undefined ? undefined : {at: entry.at, ...entry.value};
}
