import {deepStrictEqual} from 'node:assert';
import {
  EXPLORER_INBOX,
  FAMILY_COMPANIONS,
  SSH_COMPANION_ID,
  SSH_ENDPOINTS,
} from '../../src/index.ts';

describe('the endpoint ids', () => {
  it('F-5902.5.contract: the ssh endpoints and the explorer inbox are exactly the ones of the interface', () => {
    deepStrictEqual(
      [SSH_ENDPOINTS, EXPLORER_INBOX],
      [
        {
          getActiveSshRemote: {
            commandId: 'remote-internal.getActiveSshRemote',
            kind: 'query',
          },
          getConfiguredHostnames: {
            commandId: 'remote-internal.getConfiguredHostnames',
            kind: 'query',
          },
          getSshFoldersHistory: {
            commandId: 'remote-internal.getSshFoldersHistory',
            kind: 'query',
          },
          deleteSshFolderFromHistory: {
            commandId: 'remote-internal.deleteSshFolderFromHistory',
            kind: 'change',
          },
          openRemoteSshTarget: {
            commandId: 'remote-internal.openRemoteSshTarget',
            kind: 'change',
          },
        },
        {
          setActiveFolders: {
            commandId: 'remote-internal.setActiveFolders',
            kind: 'push',
          },
          sshHostsChanged: {
            commandId: 'remote-internal.sshHostsChanged',
            kind: 'push',
          },
        },
      ],
    );
  });

  it('F-5902.5.contract: every id starts with remote-internal.', () => {
    deepStrictEqual(
      [...Object.values(SSH_ENDPOINTS), ...Object.values(EXPLORER_INBOX)]
        .map(endpoint => endpoint.commandId)
        .filter(commandId => !commandId.startsWith('remote-internal.')),
      [],
    );
  });

  it('F-5902.5.contract: both objects and every member are frozen', () => {
    deepStrictEqual(
      [
        SSH_ENDPOINTS,
        EXPLORER_INBOX,
        ...Object.values(SSH_ENDPOINTS),
        ...Object.values(EXPLORER_INBOX),
      ].filter(frozen => !Object.isFrozen(frozen)),
      [],
    );
  });

  it('F-5902.5.contract: the family companions are the ssh one, frozen', () => {
    deepStrictEqual(
      [
        SSH_COMPANION_ID,
        [...FAMILY_COMPANIONS],
        Object.isFrozen(FAMILY_COMPANIONS),
      ],
      ['remote-oss.remote-ssh', ['remote-oss.remote-ssh'], true],
    );
  });
});
