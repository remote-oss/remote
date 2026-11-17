/**
 * @fileoverview The move of the legacy `remote.SSH.defaultExtensionsIfInstalledLocally` into the editor's own
 * `remote.defaultExtensionsIfInstalledLocally`: the legacy items are appended to the editor's key and the legacy key is
 * removed, in the user's settings only, when an SSH window starts. Nothing installs the legacy items; the editor
 * installs what its own key lists.
 */

import {appendExtensionIds} from 'lib-identifiers';
import type {Logger} from 'lib-log';

/** The key the extension moves out of. */
export const LEGACY_EXTENSIONS_KEY =
  'remote.SSH.defaultExtensionsIfInstalledLocally';

/** The editor's own key, which the extension moves into. */
export const CORE_EXTENSIONS_KEY = 'remote.defaultExtensionsIfInstalledLocally';

/** What the move reads and writes. */
export interface LegacyExtensionPorts {
  /** What the user's settings hold for the key, `undefined` when it is unset; other scopes are never read. */
  read(key: string): unknown;
  /** Sets what the user's settings hold for the key; `undefined` removes it. */
  write(key: string, value: unknown): PromiseLike<void>;
  logger: Logger;
}

/**
 * Moves the legacy key's items into the editor's key, then removes the legacy key. A failed read or write is logged and
 * leaves the legacy key where it was; it never fails the connect that called it.
 */
export async function migrateLegacyExtensions(
  ports: LegacyExtensionPorts,
): Promise<void> {
  try {
    const legacy = ports.read(LEGACY_EXTENSIONS_KEY);
    if (legacy === undefined) {
      ports.logger.info('no legacy remote.SSH extensions key found');
      return;
    }
    // A legacy value that is no list adds nothing, and the key is removed all the same.
    if (Array.isArray(legacy)) {
      await ports.write(
        CORE_EXTENSIONS_KEY,
        appendExtensionIds(ports.read(CORE_EXTENSIONS_KEY), legacy),
      );
    }
    await ports.write(LEGACY_EXTENSIONS_KEY, undefined);
    ports.logger.info(
      // The key names are 35 characters, which the log redacts as a possible token: the line says them in parts.
      `moved the legacy remote.SSH extensions key into the editor's remote extensions key (${String(Array.isArray(legacy) ? legacy.length : 0)} items)`,
    );
  } catch (caught) {
    ports.logger.warn(
      `the legacy remote.SSH extensions key could not be moved: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
}
