/**
 * @fileoverview The guard of the commands that open a container window: a second invocation runs its own engine check,
 * and once one invocation has passed its check a later one is absorbed, so the window gets one connect and one
 * container (F-0202 AC-45 and AC-51 with F-0401 AC-20).
 */

import type {Logger} from 'lib-log';

/** Runs one invocation of a command. */
export interface InvocationGuard {
  /**
   * Runs `attempt`. It calls the `pass` it is given once its engine check has passed; `pass` answers false, and the
   * attempt must end, when another invocation has passed its check and is still running.
   */
  run(
    title: string,
    attempt: (pass: () => boolean) => Promise<void>,
  ): Promise<void>;
}

/** A guard of one command (or of the commands that share it). */
export function invocationGuardOf(logger: Logger): InvocationGuard {
  let held = false;
  return {
    run: async (title, attempt) => {
      let mine = false;
      try {
        await attempt(() => {
          if (held) {
            logger.info(`${title} is already running`);
            return false;
          }
          held = true;
          mine = true;
          return true;
        });
      } finally {
        if (mine) {
          held = false;
        }
      }
    },
  };
}
