/**
 * @fileoverview The ports a configuration publishes through `appPort`, which the editor shows as "Statically
 * Forwarded" rows from the start of the window when the container engine is on this machine.
 */

/** A forward the connection hands the editor from the start: the container's published port and where it is here. */
export interface StaticTunnel {
  remoteAddress: {host: string; port: number};
  localAddress: string;
}

const HOST_AND_CONTAINER_PORT = /^(\d{1,5}):(\d{1,5})$/;

function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** The `unix://` address of a local socket, or no address at all, is this machine's engine. */
function isLocalSocket(dockerHost: string | undefined): boolean {
  return (
    dockerHost === undefined ||
    dockerHost === '' ||
    dockerHost.startsWith('unix://')
  );
}

/**
 * Whether the engine the connection uses is on this machine: no Docker context is named, and `DOCKER_HOST` is unset or
 * a local socket. A named context may point anywhere, so it does not count.
 */
export function engineIsLocal(options: {
  context: string | undefined;
  dockerHost: string | undefined;
}): boolean {
  return options.context === undefined && isLocalSocket(options.dockerHost);
}

/** The `appPort` of a configuration; nothing for a Compose configuration, which publishes no port of its own. */
export function appPortOf(
  configuration: Readonly<Record<string, unknown>>,
): unknown {
  return configuration.dockerComposeFile === undefined
    ? configuration.appPort
    : undefined;
}

/** The tunnel the entry stands for; nothing for an entry that is not a port or a `host:container` pair of ports. */
function tunnelOf(entry: unknown): StaticTunnel | undefined {
  if (typeof entry === 'number') {
    return isPort(entry)
      ? {
          remoteAddress: {host: '0.0.0.0', port: entry},
          localAddress: `127.0.0.1:${String(entry)}`,
        }
      : undefined;
  }
  const match =
    typeof entry === 'string' ? HOST_AND_CONTAINER_PORT.exec(entry) : null;
  const [host, container] = [Number(match?.[1]), Number(match?.[2])];
  return match !== null && isPort(host) && isPort(container)
    ? {
        remoteAddress: {host: '0.0.0.0', port: container},
        localAddress: `[::1]:${String(host)}`,
      }
    : undefined;
}

/**
 * The rows the editor shows as "Statically Forwarded" for `appPort`, in order. A single number or string is a list of
 * one. There are none for an engine that is not on this machine.
 */
export function staticForwards(
  appPort: unknown,
  local: boolean,
): StaticTunnel[] {
  if (!local) {
    return [];
  }
  const entries = Array.isArray(appPort) ? appPort : [appPort];
  return entries.flatMap(entry => tunnelOf(entry) ?? []);
}

/** The key of a published port in `NetworkSettings.Ports`: the container's port and its protocol. */
const PUBLISHED_KEY = /^(\d{1,5})\/tcp$/;

/**
 * The rows the editor shows as "Statically Forwarded" for the ports a container publishes, as `NetworkSettings.Ports`
 * of `docker inspect` holds them: one for each container port and host port, in the order of the container ports.
 * There are none for an engine that is not on this machine.
 */
export function publishedForwards(
  published: unknown,
  local: boolean,
): StaticTunnel[] {
  if (!local || typeof published !== 'object' || published === null) {
    return [];
  }
  const tunnels = new Map<string, StaticTunnel>();
  for (const [key, bindings] of Object.entries(published)) {
    const container = Number(PUBLISHED_KEY.exec(key)?.[1]);
    for (const binding of Array.isArray(bindings) ? bindings : []) {
      const host = Number((binding as {HostPort?: unknown} | null)?.HostPort);
      if (isPort(container) && isPort(host)) {
        tunnels.set(`${String(container)}:${String(host)}`, {
          remoteAddress: {host: '0.0.0.0', port: container},
          localAddress: `[::1]:${String(host)}`,
        });
      }
    }
  }
  return [...tunnels.values()].sort(
    (left, right) => left.remoteAddress.port - right.remoteAddress.port,
  );
}
