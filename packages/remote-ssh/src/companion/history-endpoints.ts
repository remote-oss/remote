/**
 * @fileoverview The two history commands Remote - SSH serves to Remote Explorer: the stored folder history, in the
 * store's own order, and the deletion of one path. Neither shows anything or writes a log line; a foreign or
 * newer-version argument never reaches a handler.
 */

import {
  type Protocol,
  readDeleteRequest,
  readEnvelope,
  type Registration,
  SSH_ENDPOINTS,
  writeDeleteResult,
  writeFoldersHistory,
} from 'lib-companion';
import {
  type HistoryMemento,
  removeOpened,
  storedHistory,
} from './folder-history.ts';
import {allOf} from './registrations.ts';

/** Registers `getSshFoldersHistory` and `deleteSshFolderFromHistory` through `protocol`; the result disposes both. */
export function serveHistoryEndpoints(
  protocol: Protocol,
  memento: HistoryMemento,
): Registration {
  const registrations = [
    protocol.serve({
      commandId: SSH_ENDPOINTS.getSshFoldersHistory.commandId,
      kind: 'query',
      read: readEnvelope,
      handle: () => writeFoldersHistory({hosts: storedHistory(memento)}),
      empty: () => writeFoldersHistory({hosts: []}),
    }),
    protocol.serve({
      commandId: SSH_ENDPOINTS.deleteSshFolderFromHistory.commandId,
      kind: 'change',
      read: readDeleteRequest,
      handle: async request =>
        writeDeleteResult({
          changed: await removeOpened(memento, request.hostKey, request.path),
        }),
    }),
  ];
  return allOf(registrations);
}
