/**
 * @fileoverview The two pushes the companion sends Remote Explorer. The first only wakes the explorer through its
 * activation event and is never used; the second makes the view read the host list again. A foreign or newer-version
 * argument never reaches either.
 */

import {
  EXPLORER_INBOX,
  type Protocol,
  readActiveFoldersPush,
  readEnvelope,
  type Registration,
} from 'lib-companion';

/** What the inbox asks of the view. */
export interface InboxTargets {
  rebuildHosts(): unknown;
}

/** Registers `setActiveFolders` and `sshHostsChanged` through `protocol`; the result disposes both. */
export function serveInbox(
  protocol: Protocol,
  targets: () => InboxTargets | undefined,
): Registration {
  const registrations = [
    protocol.serve({
      commandId: EXPLORER_INBOX.setActiveFolders.commandId,
      kind: 'push',
      read: readActiveFoldersPush,
      handle: () => undefined,
    }),
    protocol.serve({
      commandId: EXPLORER_INBOX.sshHostsChanged.commandId,
      kind: 'push',
      read: readEnvelope,
      handle: () => {
        void targets()?.rebuildHosts();
      },
    }),
  ];
  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose();
      }
    },
  };
}
