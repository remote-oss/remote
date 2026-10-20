/**
 * @fileoverview The ports a dev container configuration declares to forward: which entries of `forwardPorts` become
 * forwards, in order and once each, which start with a dash and are reported, and the protocol a port opens with.
 */

/** Where a forward goes in the container: a host name the container resolves and a port. */
export interface ForwardTarget {
  host: string;
  port: number;
}

/** What a configuration declares to forward. */
export interface DeclaredForwards {
  /** The forwards to open, in order, one per distinct target. */
  forwards: ForwardTarget[];
  /** The entries and keys that start with a dash, as written without quotes, one notice each. */
  dashed: string[];
}

/** The ports a connection declares, as the merged configuration of its container holds them. */
export interface DeclaredPorts {
  forwardPorts: unknown;
  portsAttributes: unknown;
  otherPortsAttributes: unknown;
}

const HOST_AND_PORT = /^([a-z0-9-]+):(\d{1,5})$/;

const DASHED_PORT = /^[^:]+:-/;

const SECURE_PORTS: readonly number[] = [443, 8443];

function isPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The entry as written when it starts with a dash, or when its port does; nothing for any other entry. */
function dashedEntryOf(entry: unknown): string | undefined {
  if (typeof entry === 'number') {
    return entry < 0 ? String(entry) : undefined;
  }
  if (typeof entry === 'string') {
    return entry.startsWith('-') || DASHED_PORT.test(entry) ? entry : undefined;
  }
  return undefined;
}

/** The target the entry names; nothing for an entry that is not a number or a `host:port` of the allowed form. */
function targetOf(entry: unknown): ForwardTarget | undefined {
  if (typeof entry === 'number') {
    return isPort(entry) ? {host: 'localhost', port: entry} : undefined;
  }
  if (typeof entry !== 'string') {
    return undefined;
  }
  const match = HOST_AND_PORT.exec(entry);
  const port = Number(match?.[2]);
  return match?.[1] !== undefined && isPort(port)
    ? {host: match[1], port}
    : undefined;
}

/** The forwards `forwardPorts` declares and the dashed entries of it and of the keys of `portsAttributes`. */
export function declaredForwards(
  forwardPorts: unknown,
  portsAttributes: unknown,
): DeclaredForwards {
  const forwards: ForwardTarget[] = [];
  const dashed: string[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(forwardPorts) ? forwardPorts : []) {
    const written = dashedEntryOf(entry);
    if (written !== undefined) {
      dashed.push(written);
      continue;
    }
    const target = targetOf(entry);
    const key = `${target?.host ?? ''}:${String(target?.port)}`;
    if (target !== undefined && !seen.has(key)) {
      seen.add(key);
      forwards.push(target);
    }
  }
  if (isRecord(portsAttributes)) {
    dashed.push(
      ...Object.keys(portsAttributes).filter(key => key.startsWith('-')),
    );
  }
  return {forwards, dashed};
}

/** Whether `key` of `portsAttributes` is the port itself or a range `from-to` that holds it. */
function keyHoldsPort(key: string, port: number): boolean {
  if (key === String(port)) {
    return true;
  }
  const range = /^(\d+)-(\d+)$/.exec(key);
  return range !== null && Number(range[1]) <= port && port <= Number(range[2]);
}

function setsProtocol(attributes: unknown): boolean {
  return isRecord(attributes) && typeof attributes.protocol === 'string';
}

/**
 * The protocol a forward of `port` opens with when the configuration does not choose one: `https` for the secure
 * ports 443 and 8443, nothing (core's own default) for any other.
 */
export function defaultProtocolOf(
  port: number,
  portsAttributes: unknown,
  otherPortsAttributes: unknown,
): 'https' | undefined {
  if (!SECURE_PORTS.includes(port)) {
    return undefined;
  }
  const held = isRecord(portsAttributes)
    ? Object.entries(portsAttributes).filter(([key]) => keyHoldsPort(key, port))
    : [];
  const chosen =
    held.length > 0
      ? held.some(([, attributes]) => setsProtocol(attributes))
      : setsProtocol(otherPortsAttributes);
  return chosen ? undefined : 'https';
}
