/**
 * @fileoverview A keyed map in the extension's own `globalState` whose entries expire after five minutes: what a window
 * leaves for the next one to take once, such as a rebuild intent or a pending edit. Entries that are malformed, stale
 * or dated in the future are dropped whenever the map is read.
 */

/** How long an entry lives before it is cleared unused. */
export const TIMED_ENTRY_MILLISECONDS = 5 * 60 * 1000;

/** `ExtensionContext.globalState`, narrowed. */
export interface IntentMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** One stored entry: when it was written, and what it holds. */
interface TimedEntry {
  at: number;
  value: unknown;
}

/** Whether a value is a plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entries of the stored map that are well formed, not older than the limit and not from the future. */
function liveEntries(
  stored: unknown,
  now: number,
  isValue: (value: unknown) => boolean,
): Record<string, TimedEntry> {
  const kept: Record<string, TimedEntry> = {};
  if (!isObject(stored)) {
    return kept;
  }
  for (const [id, entry] of Object.entries(stored)) {
    if (
      isObject(entry) &&
      typeof entry.at === 'number' &&
      Number.isFinite(entry.at) &&
      now - entry.at >= 0 &&
      now - entry.at <= TIMED_ENTRY_MILLISECONDS &&
      isValue(entry.value)
    ) {
      kept[id] = {at: entry.at, value: entry.value};
    }
  }
  return kept;
}

/** Writes `value` for `id`, dropping the entries that expired. A failed write rejects to the caller. */
export async function storeTimedEntry<Value>(
  memento: IntentMemento,
  key: string,
  id: string,
  value: Value,
  now: number,
): Promise<void> {
  const entries = liveEntries(memento.get(key), now, () => true);
  entries[id] = {at: now, value};
  await memento.update(key, entries);
}

/**
 * Takes the entry for `id` once. The map is written back only when it differs from what was read, so a read with
 * nothing to take writes nothing. A failed write rejects to the caller.
 */
export async function takeTimedEntry<Value>(
  memento: IntentMemento,
  key: string,
  id: string,
  now: number,
  isValue: (value: unknown) => value is Value,
): Promise<{at: number; value: Value} | undefined> {
  const stored = memento.get(key);
  const entries = liveEntries(stored, now, isValue);
  const taken = entries[id] as {at: number; value: Value} | undefined;
  delete entries[id];
  if (JSON.stringify(entries) !== JSON.stringify(stored ?? {})) {
    await memento.update(key, entries);
  }
  return taken;
}
