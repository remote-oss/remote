/**
 * @fileoverview The notice that an explicit command's first check shows once it has run for two seconds: Docker is
 * starting, with a Cancel that ends the command at once. A check that ends sooner shows nothing. Cancelling stops the
 * check's processes and ends the command with no dialog.
 */

import {deferred} from '../deferred.ts';

/** How long the first check runs before the notice shows, in milliseconds. */
export const STARTING_DOCKER_DELAY_MILLISECONDS = 2000;

/** What the notice needs of the editor. */
export interface StartingDockerPorts {
  /** Calls `callback` once after `milliseconds`; gives the way to cancel the call. */
  setTimer(callback: () => void, milliseconds: number): () => void;
  /** Shows the notice until `ended` settles; `cancel` is what its Cancel button does. */
  show(ended: Promise<void>, cancel: () => void): void;
}

/** How a watched check came out. */
export type WatchedCheck<Result> =
  {kind: 'done'; result: Result} | {kind: 'stopped'};

/**
 * Runs `check` with a signal that ends when `outer` does or when the notice is cancelled. The notice shows after
 * `STARTING_DOCKER_DELAY_MILLISECONDS` and goes when the check ends or is cancelled.
 */
export async function watchedCheck<Result>(
  ports: StartingDockerPorts,
  check: (cancellation: AbortSignal) => Promise<Result>,
  outer: AbortSignal,
): Promise<WatchedCheck<Result>> {
  const own = new AbortController();
  function forward(): void {
    own.abort();
  }
  if (outer.aborted) {
    forward();
  }
  outer.addEventListener('abort', forward, {once: true});
  const ended = deferred<undefined>();
  const stopped = deferred<WatchedCheck<Result>>();
  const cancelTimer = ports.setTimer(() => {
    ports.show(ended.promise, () => {
      own.abort();
      stopped.resolve({kind: 'stopped'});
    });
  }, STARTING_DOCKER_DELAY_MILLISECONDS);
  try {
    return await Promise.race([
      check(own.signal).then((result): WatchedCheck<Result> => ({
        kind: 'done',
        result,
      })),
      stopped.promise,
    ]);
  } finally {
    cancelTimer();
    ended.resolve(undefined);
    outer.removeEventListener('abort', forward);
  }
}
