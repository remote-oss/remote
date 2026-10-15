/**
 * @fileoverview The notification that shows while the checks before a reload take long: the connect's own start title
 * (S087), after half a second, until the checks end or something else shows.
 */

import {startTitleOf} from '../connect/progress-titles.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** How long the pre-reload work runs before its progress shows, in milliseconds. */
export const PRE_RELOAD_PROGRESS_MILLISECONDS = 500;

/** What the progress needs of the editor and the clock. */
export interface PreReloadProgressPorts {
  /** Shows a notification progress with `title` until `until` settles (`window.withProgress`, location Notification). */
  showProgress(title: string, until: Promise<void>): void;
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  translate: Translate;
}

/** A started progress. */
export interface PreReloadProgress {
  /** Closes the progress, or prevents it from opening; idempotent. */
  close(): void;
}

/** Starts the timer; at 500 ms, unless closed, it shows S087 until `close`. It never shows again once closed. */
export function startPreReloadProgress(
  ports: PreReloadProgressPorts,
): PreReloadProgress {
  let closed = false;
  let finish: (() => void) | undefined;
  const stopTimer = ports.setTimer(PRE_RELOAD_PROGRESS_MILLISECONDS, () => {
    if (closed) {
      return;
    }
    ports.showProgress(
      startTitleOf(ports.translate),
      new Promise<void>(resolve => {
        finish = resolve;
      }),
    );
  });
  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      stopTimer();
      finish?.();
    },
  };
}
