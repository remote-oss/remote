/**
 * @fileoverview The questions a build of the view asks the SSH companion (whether the window is connected, which hosts are
 * configured, what the open history holds) and the two changes the view asks of it: open a path, delete a history entry.
 * Each is a fresh call of the versioned protocol.
 */

import {
  type ActiveRemote,
  type CallOutcome,
  type DeleteResult,
  type FoldersHistory,
  type Hostnames,
  type PathKind,
  type Protocol,
  readActiveRemote,
  readDeleteResult,
  readEnvelope,
  readFoldersHistory,
  readHostnames,
  SSH_ENDPOINTS,
  type Versioned,
  writeDeleteRequest,
  writeEnvelope,
  writeOpenRequest,
} from 'lib-companion';

/** Which window a host opens in. */
export type WindowTarget = 'current' | 'new';

/** A recent folder or workspace to open on a host: its path and the kind the view decided from the path. */
export interface FolderToOpen {
  path: string;
  kind: PathKind;
}

/** The companion calls of the view. */
export interface CompanionCalls {
  activeRemote(): Promise<CallOutcome<ActiveRemote>>;
  hostnames(): Promise<CallOutcome<Hostnames>>;
  history(): Promise<CallOutcome<FoldersHistory>>;
  deleteFolder(
    hostKey: string,
    path: string,
  ): Promise<CallOutcome<DeleteResult>>;
  open(
    hostKey: string,
    target: WindowTarget,
    folder?: FolderToOpen,
  ): Promise<CallOutcome<Versioned>>;
}

/** The calls over the protocol; each makes a fresh envelope. */
export function companionCallsOf(
  protocol: Pick<Protocol, 'call'>,
): CompanionCalls {
  return {
    activeRemote: () =>
      protocol.call(
        SSH_ENDPOINTS.getActiveSshRemote.commandId,
        writeEnvelope(),
        readActiveRemote,
      ),
    hostnames: () =>
      protocol.call(
        SSH_ENDPOINTS.getConfiguredHostnames.commandId,
        writeEnvelope(),
        readHostnames,
      ),
    history: () =>
      protocol.call(
        SSH_ENDPOINTS.getSshFoldersHistory.commandId,
        writeEnvelope(),
        readFoldersHistory,
      ),
    deleteFolder: (hostKey, path) =>
      protocol.call(
        SSH_ENDPOINTS.deleteSshFolderFromHistory.commandId,
        writeDeleteRequest({hostKey, path}),
        readDeleteResult,
      ),
    open: (hostKey, target, folder) =>
      protocol.call(
        SSH_ENDPOINTS.openRemoteSshTarget.commandId,
        writeOpenRequest({
          hostKey,
          window: target,
          ...folder,
        }),
        readEnvelope,
      ),
  };
}
