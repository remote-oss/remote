/**
 * @fileoverview The two connect commands of a host row: each asks the SSH companion to open the host in the current
 * or in a new window, and nothing else happens whatever the answer is.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {WindowTarget} from './companion-calls.ts';
import type {ViewSession} from './targets.ts';

/** The handlers of the two commands. */
export interface ConnectHandlers {
  readonly connectToRemoteInCurrentWindow: CommandHandler;
  readonly connectToRemoteInNewWindow: CommandHandler;
}

/** A handler that opens the host row it is given in `target`, and does nothing for any other argument. */
function connectIn(
  session: () => ViewSession | undefined,
  target: WindowTarget,
): CommandHandler {
  return {
    execute: async argument => {
      const current = session();
      const host = current?.targets.hostOf(argument);
      if (current === undefined || host === undefined) {
        return undefined;
      }
      await current.calls.open(host.hostRow.alias, target);
      return undefined;
    },
  };
}

/** The two connect commands of a host row, over the view's session once it exists. */
export function connectHandlers(
  session: () => ViewSession | undefined,
): ConnectHandlers {
  return {
    connectToRemoteInCurrentWindow: connectIn(session, 'current'),
    connectToRemoteInNewWindow: connectIn(session, 'new'),
  };
}
