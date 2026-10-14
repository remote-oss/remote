/**
 * @fileoverview The move of an old user setting into the editor's own: the ids of
 * `dev.containers.defaultExtensionsIfInstalledLocally` go into `remote.defaultExtensionsIfInstalledLocally`, and the
 * old key is removed once they are written.
 */

import type {Logger} from 'lib-log';

/** The key the extension moves out of, which the package does not contribute. */
export const OLD_INSTALL_IF_LOCAL_KEY =
  'dev.containers.defaultExtensionsIfInstalledLocally';

/** The editor's own key, which the extension moves into. */
export const INSTALL_IF_LOCAL_KEY =
  'remote.defaultExtensionsIfInstalledLocally';

/** What the move reads and writes: the user's values of the two keys, and their writes. */
export interface InstallIfLocalPorts {
  /** The user's value of the key, `undefined` when it is unset. */
  userValue(key: string): unknown;
  /** Writes the user's value of the key; `undefined` removes it. */
  writeUserValue(key: string, value: unknown): PromiseLike<void>;
  logger: Logger;
}

/** The strings of a value that is an array; nothing for any other value. */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** The existing ids first, then the old ones that are not among them, as written and in order. */
export function mergeInstallIfLocal(
  existing: unknown,
  retired: unknown,
): string[] {
  const merged = stringsOf(existing);
  for (const entry of stringsOf(retired)) {
    if (!merged.includes(entry)) {
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Moves the old key's ids into the editor's key. The old key is removed only after the new one is written; a failed
 * write is logged and leaves the old key where it was.
 */
export async function moveInstallIfLocal(
  ports: InstallIfLocalPorts,
): Promise<void> {
  const retired = ports.userValue(OLD_INSTALL_IF_LOCAL_KEY);
  if (retired === undefined) {
    return;
  }
  try {
    await ports.writeUserValue(
      INSTALL_IF_LOCAL_KEY,
      mergeInstallIfLocal(ports.userValue(INSTALL_IF_LOCAL_KEY), retired),
    );
    await ports.writeUserValue(OLD_INSTALL_IF_LOCAL_KEY, undefined);
  } catch (error) {
    ports.logger.warn(
      `the old install-if-installed-locally setting could not be moved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
