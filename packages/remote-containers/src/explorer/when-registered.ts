/**
 * @fileoverview Showing a view of the Remote Explorer as soon as core has registered it. In a window that is
 * connecting, the package activates before the window has its views, so the view is looked for again every second,
 * until it is there, the looks are used up or the handle is disposed.
 */

import type {Logger} from 'lib-log';

/** How long the registration of the view is waited for between two looks, in milliseconds. */
export const REGISTRATION_POLL_MILLISECONDS = 1000;

/** How many looks are made before the view is given up: ten minutes, as long as a first connect may take. */
export const REGISTRATION_POLLS = 600;

/** What a view that is shown gives back. */
export interface ShownView {
  /** Reads what the view shows again now. */
  refresh(): Promise<void>;
  dispose(): void;
}

/** What the wait needs. */
export interface RegistrationPorts {
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  logger: Logger;
}

/**
 * The handle of the view that `show` makes once core has registered it; `show` gives none until then. `name` is how
 * the view is called in the log.
 */
export function whenRegistered(
  show: () => Promise<ShownView | undefined>,
  ports: RegistrationPorts,
  name: string,
): ShownView {
  const state: {
    shown: ShownView | undefined;
    stopped: boolean;
    cancelWait: (() => void) | undefined;
  } = {shown: undefined, stopped: false, cancelWait: undefined};

  function report(caught: unknown): void {
    ports.logger.error(
      `the ${name} view could not be shown: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }

  function isStopped(): boolean {
    return state.stopped;
  }

  async function look(polls: number): Promise<void> {
    if (isStopped()) {
      return;
    }
    const found = await show();
    if (found !== undefined) {
      state.shown = found;
      if (isStopped()) {
        found.dispose();
      }
      return;
    }
    if (polls === 0) {
      ports.logger.info(
        `the ${name} view is not registered, so it is not shown`,
      );
      return;
    }
    state.cancelWait = ports.setTimer(REGISTRATION_POLL_MILLISECONDS, () => {
      look(polls - 1).catch(report);
    });
  }

  look(REGISTRATION_POLLS).catch(report);
  return {
    refresh: async () => {
      await state.shown?.refresh();
    },
    dispose: () => {
      state.stopped = true;
      state.cancelWait?.();
      state.shown?.dispose();
    },
  };
}
