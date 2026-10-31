/**
 * @fileoverview Whether a container this run creates mounts the `vscode` volume: the user's
 * `dev.containers.cacheVolume`, else the deprecated `remote.containers.cacheVolume`, else true. A value that is set
 * decides by its truthiness (BR-15): `0` mounts nothing and the string `"false"` mounts.
 */

/**
 * The user's `dev.containers.cacheVolume` when it is set, else the deprecated `remote.containers.cacheVolume` when it
 * is set, else true; a set value counts by its truthiness. Only the user (global) values count: a folder's value is
 * ignored (BR-7), so both arguments are the settings' global values.
 */
export function cacheVolumeOf(
  primaryGlobal: unknown,
  deprecatedGlobal: unknown,
): boolean {
  if (primaryGlobal !== undefined) {
    return Boolean(primaryGlobal);
  }
  return deprecatedGlobal === undefined ? true : Boolean(deprecatedGlobal);
}
