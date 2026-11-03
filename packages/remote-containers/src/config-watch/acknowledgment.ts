/**
 * @fileoverview What the window remembers of the configuration files it has acknowledged: one fingerprint per file
 * identifier, in the dev container workspace's own storage.
 */

import type {IntentMemento} from '../state/timed-store.ts';

/** Our key in the workspace storage. */
export const ACKNOWLEDGMENT_KEY =
  'remote-oss.remote-containers.configurationWatch';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The stored fingerprints by identifier, or undefined when nothing usable is stored. */
export function readAcknowledgment(
  state: IntentMemento,
): ReadonlyMap<string, string> | undefined {
  const stored = state.get(ACKNOWLEDGMENT_KEY);
  const hashes = isObject(stored)
    ? isObject(stored.configurationState)
      ? stored.configurationState.contentHashes
      : undefined
    : undefined;
  if (!isObject(hashes)) {
    return undefined;
  }
  const entries = Object.entries(hashes).flatMap(([name, hash]) =>
    typeof hash === 'string' ? [[name, hash] as const] : [],
  );
  return entries.length === 0 ? undefined : new Map(entries);
}

/** Stores the fingerprints, replacing what was stored. */
export function writeAcknowledgment(
  state: IntentMemento,
  hashes: ReadonlyMap<string, string>,
): PromiseLike<void> {
  return state.update(ACKNOWLEDGMENT_KEY, {
    configurationState: {contentHashes: Object.fromEntries(hashes)},
  });
}
