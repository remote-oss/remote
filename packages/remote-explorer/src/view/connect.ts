/**
 * @fileoverview The connect commands of the rows of the SSH group: each asks the SSH companion to open the host, or the
 * recent folder of a host, in the current or in a new window; and the command that removes a recent folder from the
 * list. Nothing else happens whatever the answer is, and a row shows nothing of its own.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {FolderRow} from '../model/ssh-group.ts';
import type {WindowTarget} from './companion-calls.ts';
import type {ViewSession} from './targets.ts';

/** The handlers of the connect commands of the host rows and of the folder rows, and of the remove command. */
export interface ConnectHandlers {
  readonly connectToRemoteInCurrentWindow: CommandHandler;
  readonly connectToRemoteInNewWindow: CommandHandler;
  readonly connectToFolderInCurrentWindow: CommandHandler;
  readonly connectToFolderInNewWindow: CommandHandler;
  readonly deleteFolderHistoryItem: CommandHandler;
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

/** A handler that runs `action` on the folder row it is given, and does nothing for any other argument. */
function onFolderRow(
  session: () => ViewSession | undefined,
  action: (current: ViewSession, row: FolderRow) => Promise<void>,
): CommandHandler {
  return {
    execute: async argument => {
      const current = session();
      const folder = current?.targets.folderOf(argument);
      if (current === undefined || folder === undefined) {
        return undefined;
      }
      await action(current, folder.folderRow);
      return undefined;
    },
  };
}

/** A handler that opens the folder row it is given in `target`, with its path and the kind the path rule gives. */
function connectFolderIn(
  session: () => ViewSession | undefined,
  target: WindowTarget,
): CommandHandler {
  return onFolderRow(session, async (current, {hostKey, path, kind}) => {
    await current.calls.open(hostKey, target, {path, kind});
  });
}

/**
 * The handler that removes the folder row it is given from the recent list: with an answer, whether the companion changed
 * anything or not, every row of that path under that host goes at once; with no answer the rows stay.
 */
function deleteFolderHistoryItem(
  session: () => ViewSession | undefined,
): CommandHandler {
  return onFolderRow(session, async (current, {hostKey, path}) => {
    const outcome = await current.calls.deleteFolder(hostKey, path);
    if (outcome.status === 'answered') {
      current.targets.dropFolder(hostKey, path);
    }
  });
}

/** The connect commands of the host rows and the folder rows, and the remove command, over the view's session once it exists. */
export function connectHandlers(
  session: () => ViewSession | undefined,
): ConnectHandlers {
  return {
    connectToRemoteInCurrentWindow: connectIn(session, 'current'),
    connectToRemoteInNewWindow: connectIn(session, 'new'),
    connectToFolderInCurrentWindow: connectFolderIn(session, 'current'),
    connectToFolderInNewWindow: connectFolderIn(session, 'new'),
    deleteFolderHistoryItem: deleteFolderHistoryItem(session),
  };
}
