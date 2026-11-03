/**
 * @fileoverview The record that a clone's source was typed by the user, which the resolve after the reload needs to
 * give the source the typed treatment: without it, every source is read as one from a link. The command writes it,
 * keyed by the payload, before the reload; a successful clone clears it, so a retry still finds it. It lives in
 * the extension's own `globalState`, never synced, for a day.
 */

import {
  type IntentMemento,
  peekTimedEntry,
  storeTimedEntry,
  takeTimedEntry,
} from '../state/timed-store.ts';

/** The extension's own key in `globalState`; never synced. */
const TYPED_SOURCES_KEY = 'remote-oss.remote-containers.typedCloneSources';

/** How long a record lives. */
export const TYPED_SOURCE_MILLISECONDS = 24 * 60 * 60 * 1000;

/** The shape a stored record has. */
function isRecord(value: unknown): value is true {
  return value === true;
}

/** Records that the source of `payload` was typed. */
export function storeTypedSource(
  memento: IntentMemento,
  payload: string,
  now: number,
): Promise<void> {
  return storeTimedEntry(
    memento,
    TYPED_SOURCES_KEY,
    payload,
    true,
    now,
    TYPED_SOURCE_MILLISECONDS,
  );
}

/** Whether the source of `payload` was typed, by a record that is still live. */
export function typedSourceRecorded(
  memento: IntentMemento,
  payload: string,
  now: number,
): boolean {
  return (
    peekTimedEntry(
      memento,
      TYPED_SOURCES_KEY,
      payload,
      now,
      isRecord,
      TYPED_SOURCE_MILLISECONDS,
    ) !== undefined
  );
}

/** Clears the record of `payload`, once its clone succeeded. */
export async function clearTypedSource(
  memento: IntentMemento,
  payload: string,
  now: number,
): Promise<void> {
  await takeTimedEntry(
    memento,
    TYPED_SOURCES_KEY,
    payload,
    now,
    isRecord,
    TYPED_SOURCE_MILLISECONDS,
  );
}
