/**
 * @fileoverview The paused retry: what the failure dialog's Retry leaves for the connect that follows its reload when
 * the failed connect found a paused container, so that connect stops and starts that container instead of failing
 * again. It lives in the extension's own `globalState`, never synced, and expires after five minutes.
 */

import {
  type IntentMemento,
  storeTimedEntry,
  takeTimedEntry,
} from './timed-store.ts';

/** The extension's own key in `globalState`; never synced. */
export const PAUSED_RETRIES_KEY = 'remote-oss.remote-containers.pausedRetries';

/** The shape a stored entry's value has. */
function isRetryValue(value: unknown): value is true {
  return value === true;
}

/** Leaves a retry for the paused container `containerId`, by its full id. */
export function storePausedRetry(
  memento: IntentMemento,
  containerId: string,
  now: number,
): Promise<void> {
  return storeTimedEntry(memento, PAUSED_RETRIES_KEY, containerId, true, now);
}

/** Takes the retry for `containerId` once; false when there was none or it expired. */
export async function takePausedRetry(
  memento: IntentMemento,
  containerId: string,
  now: number,
): Promise<boolean> {
  const entry = await takeTimedEntry(
    memento,
    PAUSED_RETRIES_KEY,
    containerId,
    now,
    isRetryValue,
  );
  return entry !== undefined;
}
