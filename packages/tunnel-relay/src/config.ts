/**
 * @fileoverview The relay's settings, read from its environment once at start. A setting that is missing or invalid
 * stops the start with a message that names it.
 */

import {isClusterId} from './names.ts';

/** What the relay is configured with. */
export interface RelayConfig {
  /** The domain of `cp.<domain>`, which the hosts' and clients' addresses are built from. */
  domain: string;
  port: number;
  certificateFile: string;
  keyFile: string;
  /** The SQLite file of the store. */
  storeFile: string;
  /** The one cluster of release 1. */
  clusterId: string;
  /** The base address of the GitHub API that tells who a token belongs to. */
  githubApi: string;
  /** The file of admitted GitHub account ids. */
  allowlistFile: string;
  /** The file of the key the relay signs its tokens with. */
  tokenKeyFile: string;
  /** How many tunnels an account may have, ports a tunnel may have, and clients a tunnel may have connected. */
  limits: RelayLimits;
}

/** The relay's limits, each raisable by its operator. */
interface RelayLimits {
  tunnels: number;
  ports: number;
  clients: number;
}

/** Each limit's setting, and its value when unset. */
const LIMIT_SETTINGS: ReadonlyArray<[keyof RelayLimits, string]> = [
  ['tunnels', 'RELAY_LIMIT_TUNNELS'],
  ['ports', 'RELAY_LIMIT_PORTS'],
  ['clients', 'RELAY_LIMIT_CLIENTS'],
];

const DEFAULT_LIMIT = 10;

/** Reads the settings from `environment`, or throws naming the first that is missing or invalid. */
export function configOf(
  environment: Readonly<Record<string, string | undefined>>,
): RelayConfig {
  function valueOf(name: string): string {
    const value = environment[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is not set`);
    }
    return value;
  }
  const port = Number(valueOf('RELAY_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('RELAY_PORT is not a port number');
  }
  const clusterId = valueOf('RELAY_CLUSTER');
  if (!isClusterId(clusterId)) {
    throw new Error("RELAY_CLUSTER does not match the contract's cluster id");
  }
  const limits = {tunnels: 0, ports: 0, clients: 0};
  for (const [limit, name] of LIMIT_SETTINGS) {
    const value = Number(environment[name] ?? DEFAULT_LIMIT);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} is not a positive whole number`);
    }
    limits[limit] = value;
  }
  return {
    domain: valueOf('RELAY_DOMAIN'),
    port,
    certificateFile: valueOf('TLS_CERT'),
    keyFile: valueOf('TLS_KEY'),
    storeFile: valueOf('RELAY_STORE'),
    clusterId,
    githubApi: environment.RELAY_GITHUB_API ?? 'https://api.github.com',
    allowlistFile: valueOf('RELAY_ALLOWLIST'),
    tokenKeyFile: valueOf('RELAY_TOKEN_KEY'),
    limits,
  };
}
