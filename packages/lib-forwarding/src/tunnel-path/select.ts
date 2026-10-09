/**
 * @fileoverview The pure decisions of a window connect's forwarding: which tunnel path it takes through the SSH
 * connection, how many logins that costs, who holds the user's forwards, and where each path ends on the host.
 */

/** The three settings that decide the path (the window's, as read at connect). */
export interface TunnelSettings {
  listenOnSocket: boolean;
  useLocalServer: boolean;
  enableDynamicForwarding: boolean;
}

/** Where the window's port forwards go. */
export type TunnelPath = 'socket' | 'socks' | 'secondSsh';

/** What keeps the user's forwards running. */
export type ForwardingHolder =
  'localConnectionServer' | 'installConnection' | 'tunnelSsh';

/** Whether the connection uses a local server, as the settings in force say. */
export function effectiveUseLocalServer(
  settings: Pick<TunnelSettings, 'listenOnSocket' | 'useLocalServer'>,
): boolean {
  if (settings.listenOnSocket) {
    return false;
  }
  return settings.useLocalServer;
}

/** The path a connect's forwards take: the socket, a SOCKS forward, or a second SSH session. */
export function selectTunnelPath(settings: TunnelSettings): TunnelPath {
  if (settings.listenOnSocket) {
    return 'socket';
  }
  if (!settings.useLocalServer && !settings.enableDynamicForwarding) {
    return 'secondSsh';
  }
  return 'socks';
}

/** The logins a connect makes for the path: socks is the connection's own, or none when it reuses a running server. */
export function loginsPerConnect(
  path: TunnelPath,
  reusesRunningServer: boolean,
): number {
  if (path === 'socks') {
    return reusesRunningServer ? 0 : 1;
  }
  return 2;
}

/** What keeps the user's forwards running for a path that forwards. */
export function userForwardingHolder(
  path: 'socks' | 'secondSsh',
  useLocalServer: boolean,
): ForwardingHolder {
  if (path === 'secondSsh') {
    return 'tunnelSsh';
  }
  return useLocalServer ? 'localConnectionServer' : 'installConnection';
}

/** Where a path reaches the host: the socket, or the host's loopback port. */
export function tunnelDestination(
  path: TunnelPath,
  endpoint: {port: number; socketPath: string},
): string {
  if (path === 'socket') {
    return endpoint.socketPath;
  }
  return `127.0.0.1:${String(endpoint.port)}`;
}
