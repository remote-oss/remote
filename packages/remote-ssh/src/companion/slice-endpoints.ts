/**
 * @fileoverview The commands Remote - SSH serves to Remote Explorer: the configured hosts, the window's active remote
 * and the opening of a window on a host. Each is answered from what the window already knows, shows nothing and
 * writes no history; a foreign or newer-version argument never reaches a handler. The history commands are served in
 * `history-endpoints.ts`.
 */

import {type LastResolve, type OpenerHost, openRemote} from 'lib-authority';
import {
  type Protocol,
  readEnvelope,
  readOpenRequest,
  type Registration,
  SSH_ENDPOINTS,
  type VersionMismatch,
  writeActiveRemote,
  writeEnvelope,
  writeHostnames,
} from 'lib-companion';
import type {Logger} from 'lib-log';
import type {HostListResult} from 'lib-ssh';
import {windowlessLine} from '../connect/windowless.ts';
import {allOf} from './registrations.ts';

/** What the three endpoints take from the editor and the window. */
export interface SliceEndpointPorts {
  /** The hosts of the files in effect, read at each call: the host pick's own reading. */
  listHosts(): HostListResult;
  /** The source the hosts are read from: the value of `remote.SSH.configFile`, empty when unset. */
  hostSource(): string;
  /** The window's connection, as `ConnectRegistration.activeConnection` gives it. */
  activeConnection(): {hostKey: string; lastResolve: LastResolve} | undefined;
  /** The editor's commands, for the window opener. */
  opener: OpenerHost;
  /** The Remote - SSH log. */
  logger: Logger;
  /** Whether the editor grants `resolvers`: without it a window opened on a host can't connect, so none is opened. */
  resolversGranted: boolean;
}

/** The one log line of a version mismatch. */
export function mismatchLine(mismatch: VersionMismatch): string {
  return `${mismatch.commandId}: the other extension uses interface version ${String(mismatch.receivedMajor)}, and Remote - SSH uses version ${String(mismatch.ownMajor)}. Update Remote - SSH and Remote Explorer to matching versions.`;
}

/** The log line of a host list that couldn't be read. */
export function hostListLine(file: string, reason: string): string {
  return `The Remotes view gets no hosts: ${file}: ${reason}`;
}

/** The names of the configured hosts. When the files can't be read, the names last read from the same source, or a rejection with the parser's message when there are none; one log line either way. */
function hostnamesOf(
  ports: SliceEndpointPorts,
  memory: {lastGood?: {source: string; hostnames: string[]}},
) {
  const listing = ports.listHosts();
  if ('parseError' in listing) {
    const {file, reason} = listing.parseError;
    ports.logger.warn(hostListLine(file, reason));
    if (memory.lastGood?.source === ports.hostSource()) {
      return writeHostnames({hostnames: memory.lastGood.hostnames});
    }
    throw new Error(`${file}: ${reason}`);
  }
  const hostnames = listing.hosts.map(entry => entry.name);
  memory.lastGood = {source: ports.hostSource(), hostnames};
  return writeHostnames({hostnames});
}

/** The window's active remote: connected from the first successful resolve until a resolve fails. */
function activeRemoteOf(ports: SliceEndpointPorts) {
  const connection = ports.activeConnection();
  return connection?.lastResolve === 'succeeded'
    ? writeActiveRemote({connected: true, hostKey: connection.hostKey})
    : writeActiveRemote({connected: false});
}

/** Registers the three endpoints through `protocol`; the result disposes all three. */
export function serveSliceEndpoints(
  protocol: Protocol,
  ports: SliceEndpointPorts,
): Registration {
  const memory: {lastGood?: {source: string; hostnames: string[]}} = {};
  const registrations = [
    protocol.serve({
      commandId: SSH_ENDPOINTS.getConfiguredHostnames.commandId,
      kind: 'query',
      read: readEnvelope,
      handle: () => hostnamesOf(ports, memory),
      empty: () => writeHostnames({hostnames: []}),
    }),
    protocol.serve({
      commandId: SSH_ENDPOINTS.getActiveSshRemote.commandId,
      kind: 'query',
      read: readEnvelope,
      handle: () => activeRemoteOf(ports),
      empty: () => writeActiveRemote({connected: false}),
    }),
    protocol.serve({
      commandId: SSH_ENDPOINTS.openRemoteSshTarget.commandId,
      kind: 'change',
      read: readOpenRequest,
      handle: async request => {
        if (!ports.resolversGranted) {
          // A no-change answer, so the caller shows nothing of its own and the setup notice stays in front.
          ports.logger.info(
            windowlessLine(SSH_ENDPOINTS.openRemoteSshTarget.commandId),
          );
          return writeEnvelope();
        }
        if (request.hostKey === '') {
          throw new Error('the host key is empty');
        }
        if (request.path !== undefined && request.kind === undefined) {
          throw new Error('a path needs its kind');
        }
        const outcome = await openRemote(
          ports.opener,
          `ssh-remote+${request.hostKey}`,
          request.path !== undefined && request.kind !== undefined
            ? {
                path: request.path,
                pathKind: request.kind,
                target: request.window,
              }
            : {pathKind: 'folder', target: request.window},
        );
        if (outcome.kind === 'rejected') {
          throw new Error(outcome.reason);
        }
        return writeEnvelope();
      },
    }),
  ];
  return allOf(registrations);
}
