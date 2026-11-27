/**
 * @fileoverview The extension ids of a list setting: the ids an old setting held, appended to the list of the setting
 * that replaces it.
 */

/** The strings in `value` when it is a list, in order; none for any other value. */
function stringsIn(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value) ? value : [];
  return items.filter((item): item is string => typeof item === 'string');
}

/**
 * The ids of `existing`, as written, then each id of `appended` whose lower-cased form is not there yet, in order: the
 * editor reads an extension id without regard to case. A value that is no list counts as empty, and so does any item
 * that is no string.
 */
export function appendExtensionIds(
  existing: unknown,
  appended: unknown,
): string[] {
  const merged = stringsIn(existing);
  const seen = new Set(merged.map(identifier => identifier.toLowerCase()));
  for (const identifier of stringsIn(appended)) {
    if (!seen.has(identifier.toLowerCase())) {
      seen.add(identifier.toLowerCase());
      merged.push(identifier);
    }
  }
  return merged;
}
