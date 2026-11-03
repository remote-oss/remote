/**
 * @fileoverview A keyed map in the extension's own `globalState` whose entries expire, after five minutes unless the
 * caller gives another lifetime: what a window leaves for the next one to take once, such as a rebuild intent or a
 * pending edit, or to read on each connect. Entries that are malformed, stale or dated in the future are dropped
 * whenever the map is written.
 */

/** How long an entry lives before it is cleared unused, unless the caller says otherwise. */
export const TIMED_ENTRY_MILLISECONDS = 5 * 60 * 1000;

/** `ExtensionContext.globalState`, narrowed. */
export interface IntentMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** One stored entry: when it was written, and what it holds. */
export interface TimedEntry<Value> {
  storedAt: number;
  value: Value;
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
  lifetime: number,
): Array<[string, TimedEntry<unknown>]> {
  if (!isObject(stored)) {
    return [];
  }
  const kept: Array<[string, TimedEntry<unknown>]> = [];
  for (const [entryName, entry] of Object.entries(stored)) {
    if (
      isObject(entry) &&
      typeof entry.storedAt === 'number' &&
      Number.isFinite(entry.storedAt) &&
      now - entry.storedAt >= 0 &&
      now - entry.storedAt <= lifetime &&
      isValue(entry.value)
    ) {
      kept.push([entryName, {storedAt: entry.storedAt, value: entry.value}]);
    }
  }
  return kept;
}

/** Writes `value` under `entryName`, dropping the entries that expired. A failed write rejects to the caller. */
export async function storeTimedEntry(
  memento: IntentMemento,
  key: string,
  entryName: string,
  value: unknown,
  now: number,
  lifetime = TIMED_ENTRY_MILLISECONDS,
): Promise<void> {
  const others = liveEntries(
    memento.get(key),
    now,
    () => true,
    lifetime,
  ).filter(([name]) => name !== entryName);
  await memento.update(
    key,
    Object.fromEntries([...others, [entryName, {storedAt: now, value}]]),
  );
}

/**
 * Takes the entry under `entryName` once. The map is written back only when it differs from what was read, so a read
 * with nothing to take writes nothing. A failed write rejects to the caller.
 */
export async function takeTimedEntry<Value>(
  memento: IntentMemento,
  key: string,
  entryName: string,
  now: number,
  isValue: (value: unknown) => value is Value,
  lifetime = TIMED_ENTRY_MILLISECONDS,
): Promise<TimedEntry<Value> | undefined> {
  const stored = memento.get(key);
  const entries = liveEntries(stored, now, isValue, lifetime);
  const remaining = Object.fromEntries(
    entries.filter(([name]) => name !== entryName),
  );
  if (JSON.stringify(remaining) !== JSON.stringify(stored ?? {})) {
    await memento.update(key, remaining);
  }
  return entries.find(([name]) => name === entryName)?.[1] as
    TimedEntry<Value> | undefined;
}

/** The entry under `entryName`, left in place; none when there is none or it expired. Nothing is written. */
export function peekTimedEntry<Value>(
  memento: IntentMemento,
  key: string,
  entryName: string,
  now: number,
  isValue: (value: unknown) => value is Value,
  lifetime = TIMED_ENTRY_MILLISECONDS,
): TimedEntry<Value> | undefined {
  return liveEntries(memento.get(key), now, isValue, lifetime).find(
    ([name]) => name === entryName,
  )?.[1] as TimedEntry<Value> | undefined;
}
