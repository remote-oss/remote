/**
 * @fileoverview The connection hints as the extension's files in the editor's global storage hold them, read the way
 * the extension's README documents the accessor: every window's file is a list of events, the newest event of each
 * record decides, the newest clear hides the records that started at or before it, and the two newest records show,
 * oldest first. It imports nothing from the harness, so that the tools project can test it.
 */

/** Where the extension keeps the hints: its folder of one file per window, under the profile's global storage. */
export const HINTS_FOLDER = [
  'User',
  'globalStorage',
  'remote-oss.remote-ssh',
  'connection-hints',
] as const;

/** The records of the store: when each resolve started, and the hints it kept. */
export type HintRecords = Array<{
  started: string;
  hints: Array<{
    kind?: string;
    status?: string;
    statusNumber?: number;
    text?: string;
    message?: string;
    details?: string;
    mitigations?: string[];
    resources?: string[];
  }>;
}>;

/** One change a window's file holds: a record as it was then, or a clear. */
interface StoredEvent {
  kind?: string;
  time?: number;
  record?: HintRecords[number];
  clearedAt?: string;
}

/** How many records the store shows. */
const RECORDS_SHOWN = 2;

/** The events of a file's text; a text that is not one of ours has none. */
function eventsIn(text: string): StoredEvent[] {
  try {
    return (JSON.parse(text) as {events?: StoredEvent[]}).events ?? [];
  } catch {
    return [];
  }
}

/** The records of the store, from the texts of the windows' files and claims. */
export function recordsOf(texts: readonly string[]): HintRecords {
  const newest = new Map<string, StoredEvent>();
  for (const event of texts.flatMap(eventsIn)) {
    const key =
      event.kind === 'clear'
        ? 'clear'
        : `record ${event.record?.started ?? ''}`;
    const known = newest.get(key);
    if (known === undefined || (event.time ?? 0) >= (known.time ?? 0)) {
      newest.set(key, event);
    }
  }
  const clearedAt = newest.get('clear')?.clearedAt;
  return [...newest.values()]
    .flatMap(event =>
      event.kind === 'record' && event.record !== undefined
        ? [event.record]
        : [],
    )
    .filter(record => clearedAt === undefined || record.started > clearedAt)
    .sort((first, second) => first.started.localeCompare(second.started))
    .slice(-RECORDS_SHOWN);
}
