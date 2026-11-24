/**
 * @fileoverview The folder history as the extension's files in the editor's global storage hold it, read beside the
 * history the window answers, so that a row which finds an entry missing can say whether the files or the window's
 * reading of them lost the entry. It imports nothing from the harness, so that the tools project can test it.
 */

/** Where the extension keeps the history: its folder of one file per window, under the profile's global storage. */
export const HISTORY_FOLDER = [
  'User',
  'globalStorage',
  'remote-oss.remote-ssh',
  'folder-history',
] as const;

/** One change a window's file holds. */
interface StoredEvent {
  host?: string;
  entry?: {path?: string};
  kind?: string;
  time?: number;
}

/**
 * The paths of `hostKey`'s history that start with `scope`, most recent first, from the texts of the windows' files:
 * the newest event of each path decides, and a path whose newest event removed it is not listed.
 */
export function storedPathsOf(
  texts: readonly string[],
  hostKey: string,
  scope: string,
): string[] {
  const newest = new Map<string, StoredEvent>();
  for (const text of texts) {
    const events = (JSON.parse(text) as {events?: StoredEvent[]}).events ?? [];
    for (const event of events) {
      const known = newest.get(event.entry?.path ?? '');
      if (
        event.host === hostKey &&
        (known === undefined || (event.time ?? 0) >= (known.time ?? 0))
      ) {
        newest.set(event.entry?.path ?? '', event);
      }
    }
  }
  return [...newest.entries()]
    .filter(
      ([found, event]) => event.kind === 'opened' && found.startsWith(scope),
    )
    .sort(([, first], [, second]) => (second.time ?? 0) - (first.time ?? 0))
    .map(([found]) => found);
}
