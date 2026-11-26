/**
 * @fileoverview The rebuild intent: what a window leaves for the resolve that follows its reload, so that the next
 * connect removes and builds the container again. It is one file of the extension's own storage for each payload,
 * taken once by the window that gets to it first, and expires after five minutes.
 */

import {
  type HandoffKind,
  leaveHandoff,
  takeHandoff,
} from '../state/handoffs.ts';

/** The key under which an earlier version kept the intents in the global state. */
export const REBUILD_INTENTS_KEY =
  'remote-oss.remote-containers.rebuildIntents';

/** What a rebuild command asks for beyond removing the container. */
export interface RebuildOptions {
  buildNoCache: boolean;
}

/** A taken intent: when it was stored, and what it asks. */
export interface RebuildIntent {
  storedAt: number;
  removeExistingContainer: true;
  buildNoCache: boolean;
}

/** What a stored intent holds. */
export interface RebuildIntentValue {
  removeExistingContainer: true;
  buildNoCache: boolean;
}

/** The shape a stored intent has. */
export function isIntentValue(value: unknown): value is RebuildIntentValue {
  const record = value as Record<string, unknown> | null;
  return (
    typeof record === 'object' &&
    record !== null &&
    record.removeExistingContainer === true &&
    typeof record.buildNoCache === 'boolean'
  );
}

/** The handoffs of rebuild intents. */
export type RebuildHandoffs = HandoffKind<RebuildIntentValue>;

/** Leaves an intent for `payload`, the authority's payload of the window that will reload. */
export function storeRebuildIntent(
  handoffs: RebuildHandoffs,
  payload: string,
  options: RebuildOptions,
): Promise<void> {
  return leaveHandoff(handoffs, payload, {
    removeExistingContainer: true,
    buildNoCache: options.buildNoCache,
  });
}

/** Takes the intent for `payload` once; none when there was none or it expired. */
export function takeRebuildIntent(
  handoffs: RebuildHandoffs,
  payload: string,
): RebuildIntent | undefined {
  const entry = takeHandoff(handoffs, payload);
  return entry === undefined
    ? undefined
    : {storedAt: entry.storedAt, ...entry.value};
}
