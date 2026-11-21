/**
 * @fileoverview The folder history as the editor's global storage database holds it, read beside the history the
 * window answers, so that a row which finds an entry missing can say whether the stored value or the window's reading
 * of it lost the entry. It imports nothing from the harness, so that the tools project can test it.
 */

/** Where the extension keeps the history in the database: its id as the key, and the history's own key in the value. */
export const STORED_EXTENSION_KEY = 'remote-oss.remote-ssh';
const HISTORY_KEY = 'folder.history.v1';

/** The paths of `hostKey`'s stored history that start with `scope`, most recent first, from the database's text value. */
export function storedPathsOf(
  text: string,
  hostKey: string,
  scope: string,
): string[] {
  const value = (JSON.parse(text) as Record<string, unknown>)[HISTORY_KEY] as
    | {hosts?: Array<{hostKey?: string; entries?: Array<{path?: string}>}>}
    | undefined;
  const host = value?.hosts?.find(each => each.hostKey === hostKey);
  return (host?.entries ?? [])
    .map(entry => entry.path ?? '')
    .filter(each => each.startsWith(scope));
}
