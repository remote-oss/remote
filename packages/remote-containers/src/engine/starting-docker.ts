/**
 * @fileoverview The notices of the checks before a reload that show only when the work runs long: a delayed notice
 * that goes when its work ends, and the first check's S332 notice (Docker is starting), shown after two seconds with a
 * Cancel that ends the command at once. A check that ends sooner shows nothing. Cancelling stops the check's processes
 * and ends the command with no dialog.
 */

import {deferred} from '../deferred.ts';

/** How long the first check runs before the notice shows, in milliseconds. */
export const STARTING_DOCKER_DELAY_MILLISECONDS = 2000;

/** What a notice needs of the clock. */
export interface NoticeTimer {
  /** Calls `callback` once after `milliseconds`; gives the way to cancel the call. */
  setTimer(callback: () => void, milliseconds: number): () => void;
}

/** What the notice needs of the editor. */
export interface StartingDockerPorts extends NoticeTimer {
  /** Shows the notice until `ended` settles; `cancel` is what its Cancel button does. */
  show(ended: Promise<undefined>, cancel: () => void): void;
}

/** A notice that may still show. */
export interface DelayedNotice {
  /** Ends the notice, or prevents it from showing; idempotent. */
  close(): void;
}

/**
 * Calls `show` with a promise that settles on `close`, once `delayMilliseconds` have passed, unless `close` came
 * first. It never shows again once closed.
 */
export function delayedNotice(
  timer: NoticeTimer,
  delayMilliseconds: number,
  show: (ended: Promise<undefined>) => void,
): DelayedNotice {
  const ended = deferred<undefined>();
  let closed = false;
  const stopTimer = timer.setTimer(() => {
    if (!closed) {
      show(ended.promise);
    }
  }, delayMilliseconds);
  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      stopTimer();
      ended.resolve(undefined);
    },
  };
}

/** How a watched check came out. */
export type WatchedCheck<Result> =
  {kind: 'done'; result: Result} | {kind: 'stopped'};

/**
 * Runs `check` with a signal that ends when `outer` does or when the notice is cancelled. The notice shows after
 * `STARTING_DOCKER_DELAY_MILLISECONDS` and goes when the check ends, is cancelled, or calls `noticeOver` (a dialog of
 * the check is about to show).
 */
export async function watchedCheck<Result>(
  ports: StartingDockerPorts,
  check: (cancellation: AbortSignal, noticeOver: () => void) => Promise<Result>,
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
  const stopped = deferred<WatchedCheck<Result>>();
  const notice = delayedNotice(
    ports,
    STARTING_DOCKER_DELAY_MILLISECONDS,
    ended => {
      ports.show(ended, () => {
        own.abort();
        stopped.resolve({kind: 'stopped'});
      });
    },
  );
  try {
    return await Promise.race([
      check(own.signal, () => {
        notice.close();
      }).then((result): WatchedCheck<Result> => ({
        kind: 'done',
        result,
      })),
      stopped.promise,
    ]);
  } finally {
    notice.close();
    outer.removeEventListener('abort', forward);
  }
}
