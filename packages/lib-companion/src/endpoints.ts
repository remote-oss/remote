/**
 * @fileoverview The ids of the family companions that Remote Explorer looks for and of the commands they exchange,
 * with the kind of each: a query answers, a change acts, a push only wakes the other side.
 */

/** What a command does for its caller. */
export type EndpointKind = 'query' | 'change' | 'push';

/** One command of the interface: its id and its kind. */
export interface EndpointId {
  readonly commandId: string;
  readonly kind: EndpointKind;
}

/** The family companion that serves the "SSH" group. */
export const SSH_COMPANION_ID = 'remote-oss.remote-ssh';

/** The id of a family companion. */
export type CompanionId = typeof SSH_COMPANION_ID;

/** The family companions Remote Explorer looks for, in this order. */
export const FAMILY_COMPANIONS: readonly CompanionId[] = Object.freeze([
  SSH_COMPANION_ID,
]);

/** The commands Remote Explorer serves for the companions. */
export const EXPLORER_INBOX = Object.freeze({
  setActiveFolders: Object.freeze({
    commandId: 'remote-internal.setActiveFolders',
    kind: 'push',
  } as const),
  sshHostsChanged: Object.freeze({
    commandId: 'remote-internal.sshHostsChanged',
    kind: 'push',
  } as const),
});

/** The commands the SSH companion serves. */
export const SSH_ENDPOINTS = Object.freeze({
  getActiveSshRemote: Object.freeze({
    commandId: 'remote-internal.getActiveSshRemote',
    kind: 'query',
  } as const),
  getConfiguredHostnames: Object.freeze({
    commandId: 'remote-internal.getConfiguredHostnames',
    kind: 'query',
  } as const),
  getSshFoldersHistory: Object.freeze({
    commandId: 'remote-internal.getSshFoldersHistory',
    kind: 'query',
  } as const),
  deleteSshFolderFromHistory: Object.freeze({
    commandId: 'remote-internal.deleteSshFolderFromHistory',
    kind: 'change',
  } as const),
  openRemoteSshTarget: Object.freeze({
    commandId: 'remote-internal.openRemoteSshTarget',
    kind: 'change',
  } as const),
});

/** The commands of the SSH companion that the explorer's group row runs with no argument. */
export const SSH_HAND_OVERS = Object.freeze({
  openConfigFile: 'opensshremotes.openConfigFile',
  addNewSshHost: 'opensshremotes.addNewSshHost',
} as const);
