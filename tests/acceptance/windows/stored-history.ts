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

/** A file of the history folder: its name, which says whose events it holds, and its text. */
export interface StoredFile {
  name: string;
  text: string;
}

/** A window's file, and its claim while another window folds it: the names the store reads, as it matches them. */
const SESSION_FILE = /^([0-9a-f-]+)\.json$/u;
const CLAIM_FILE = /^([0-9a-f-]+)\.claim-[0-9a-f]+$/u;

/** The session whose events a file holds: its own file's or its claim's; none for a write not yet renamed and any other name. */
function ownerOf(name: string): string | undefined {
  return SESSION_FILE.exec(name)?.[1] ?? CLAIM_FILE.exec(name)?.[1];
}

/**
 * The paths of `hostKey`'s history that start with `scope`, most recent first, from the files of the history folder as
 * the extension reads them: the newest event of each path decides, an event at the same time as another decides when its
 * session sorts later, a claim is read as its session's file, a write not yet renamed (`<session>.json.tmp-<hex>`) and any
 * other name are not read, and a path whose newest event removed it is not listed. The earlier version's value in the
 * global state, which the extension reads as the oldest layer, is not read here.
 */
export function storedPathsOf(
  files: readonly StoredFile[],
  hostKey: string,
  scope: string,
): string[] {
  const newest = new Map<string, {event: StoredEvent; session: string}>();
  for (const {name, text} of files) {
    const session = ownerOf(name);
    if (session === undefined) {
      continue;
    }
    const events = (JSON.parse(text) as {events?: StoredEvent[]}).events ?? [];
    for (const event of events) {
      const known = newest.get(event.entry?.path ?? '');
      const time = event.time ?? 0;
      if (
        event.host === hostKey &&
        (known === undefined ||
          time > (known.event.time ?? 0) ||
          (time === (known.event.time ?? 0) && session > known.session))
      ) {
        newest.set(event.entry?.path ?? '', {event, session});
      }
    }
  }
  return [...newest.entries()]
    .filter(
      ([found, {event}]) => event.kind === 'opened' && found.startsWith(scope),
    )
    .sort(
      ([, first], [, second]) =>
        (second.event.time ?? 0) - (first.event.time ?? 0) ||
        second.session.localeCompare(first.session),
    )
    .map(([found]) => found);
}
