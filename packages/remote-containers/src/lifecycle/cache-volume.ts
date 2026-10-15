/**
 * @fileoverview Whether a container this run creates mounts the `vscode` volume: the user's
 * `dev.containers.cacheVolume`, else the deprecated `remote.containers.cacheVolume`, else true.
 */

/**
 * The user's `dev.containers.cacheVolume`, else the deprecated `remote.containers.cacheVolume`, else true. Only the
 * user (global) values count: a folder's value is ignored (BR-7), so both arguments are the settings' global values.
 */
export function cacheVolumeOf(
  primaryGlobal: unknown,
  deprecatedGlobal: unknown,
): boolean {
  if (typeof primaryGlobal === 'boolean') {
    return primaryGlobal;
  }
  return typeof deprecatedGlobal === 'boolean' ? deprecatedGlobal : true;
}
