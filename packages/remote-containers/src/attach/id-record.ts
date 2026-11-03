/**
 * @fileoverview The id record of attached containers: the id a payload's container had at the last successful attach,
 * kept in the profile's global state under a key of ours, so that a renamed container is found again.
 */

import {recordOf} from '../json-record.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import type {IdRecord} from './find.ts';

/** The global state key of the record: a map from payload to container id. */
export const ATTACHED_IDS_KEY =
  'remote-oss.remote-containers.attachedContainerIds';

/** The record over `memento`; a value that is not a map of text is the same as no record. */
export function idRecordOf(memento: IntentMemento): IdRecord {
  /** The map as it is stored: only the entries whose id is text. */
  function stored(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(recordOf(memento.get(ATTACHED_IDS_KEY)) ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }
  return {
    read: payload => stored()[payload],
    write: (payload, containerId) =>
      memento.update(ATTACHED_IDS_KEY, {...stored(), [payload]: containerId}),
  };
}
