/**
 * @fileoverview The extensions to install in a new container: the entries of the configuration's layers and of the
 * user's setting, and the one rule that turns them into the list the server is asked to install.
 */

/** Whether a value is a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The strings of a value that is an array; nothing for any other value. */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** The `extensions` of each `customizations.vscode` layer, in order; anything that isn't a string is skipped. */
export function configurationEntries(
  mergedConfiguration: Record<string, unknown> | undefined,
): string[] {
  const customizations = mergedConfiguration?.customizations;
  const layers = isRecord(customizations) ? customizations.vscode : undefined;
  if (!Array.isArray(layers)) {
    return [];
  }
  return layers.flatMap(layer =>
    isRecord(layer) ? stringsOf(layer.extensions) : [],
  );
}

/**
 * The entries of the user's setting: the new key's value when the user set it at all, even to an empty list, else the
 * deprecated key's. Each is the key's user value, `undefined` when unset.
 */
export function settingEntries(
  primary: unknown,
  deprecated: unknown,
): string[] {
  return stringsOf(primary === undefined ? deprecated : primary);
}

/** The id of an entry: the text after a leading `-` and before the first `@`. */
function identifierOf(entry: string): string {
  const unmarked = entry.startsWith('-') ? entry.slice(1) : entry;
  const separator = unmarked.indexOf('@');
  return separator === -1 ? unmarked : unmarked.slice(0, separator);
}

/**
 * The list to install, from the entries front to back. A removal (`-id`) drops the earlier entries of that id, and
 * adds nothing. An addition drops the earlier entries of its id and goes to the end, as written. Ids are compared
 * as written, case included, and nothing is checked.
 */
export function effectiveExtensions(entries: readonly string[]): string[] {
  let list: string[] = [];
  for (const entry of entries) {
    const extensionId = identifierOf(entry);
    list = list.filter(kept => identifierOf(kept) !== extensionId);
    if (!entry.startsWith('-')) {
      list.push(entry);
    }
  }
  return list;
}
