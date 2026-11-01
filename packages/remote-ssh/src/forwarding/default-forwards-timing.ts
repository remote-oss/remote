/**
 * @fileoverview When the default forwards are read. The setting is read once per connect or reload, and later than
 * the connect's end: at that moment the window has the user value only, and the remote folder's `.vscode/settings.json`
 * and the remote Machine settings are in a moment after (measured: 164 and 501 ms on a fresh connect).
 * The read waits for the first signal that the settings changed or that the folder was trusted, or for a bound.
 */

import type {Scheduler} from 'lib-helper';

/** The editor's events the read waits on, as ports so that the wait unit-tests without the editor. */
export interface DefaultReadEvents {
  /** Whether the window's folder is trusted now. */
  isTrusted(): boolean;
  /** Calls `listener` when the folder is trusted; gives back what removes the listener. */
  onTrustGranted(listener: () => void): {dispose(): void};
  /** Calls `listener` when a change reaches `remote.SSH.defaultForwardedPorts`; gives back what removes the listener. */
  onSettingChanged(listener: () => void): {dispose(): void};
}

/**
 * The longest the read waits for a signal. The window's settings arrive within about half a second of the connect's
 * end when there are any, and a change that never comes (the layers were there from the start, as after a reload) must
 * not hold the forwards back for more than BR-4's window of two to eight seconds after the resolve.
 */
export const READ_BOUND_MILLISECONDS = 5_000;

/** What ended the wait. */
export type ReadSignal = 'trust' | 'configuration' | 'bound';

/**
 * Resolves with the first of: the folder being trusted (only when it is not trusted yet), a change reaching the
 * setting, and the bound. The listeners and the timer are removed once one of them has fired.
 */
export function waitForDefaultRead(
  events: DefaultReadEvents,
  scheduler: Scheduler,
  bound = READ_BOUND_MILLISECONDS,
): Promise<ReadSignal> {
  return new Promise(resolve => {
    const waits: Array<{dispose(): void}> = [];
    let fired = false;
    function fire(signal: ReadSignal): void {
      fired = true;
      for (const wait of waits.splice(0)) {
        wait.dispose();
      }
      resolve(signal);
    }
    /** Keeps `wait` to remove it, or removes it at once when a signal has fired while it was being set. */
    function keep(wait: {dispose(): void}): void {
      if (fired) {
        wait.dispose();
      } else {
        waits.push(wait);
      }
    }
    if (!events.isTrusted()) {
      keep(
        events.onTrustGranted(() => {
          fire('trust');
        }),
      );
    }
    keep(
      events.onSettingChanged(() => {
        fire('configuration');
      }),
    );
    const cancel = scheduler.setTimer(bound, () => {
      fire('bound');
    });
    keep({dispose: cancel});
  });
}
