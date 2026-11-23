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
}

/** Reads the settings from `environment`, or throws naming the first that is missing or invalid. */
export function configOf(
  environment: Readonly<Record<string, string | undefined>>,
): RelayConfig {
  const valueOf = (name: string): string => {
    const value = environment[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is not set`);
    }
    return value;
  };
  const port = Number(valueOf('RELAY_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('RELAY_PORT is not a port number');
  }
  const clusterId = valueOf('RELAY_CLUSTER');
  if (!isClusterId(clusterId)) {
    throw new Error("RELAY_CLUSTER does not match the contract's cluster id");
  }
  return {
    domain: valueOf('RELAY_DOMAIN'),
    port,
    certificateFile: valueOf('TLS_CERT'),
    keyFile: valueOf('TLS_KEY'),
    storeFile: valueOf('RELAY_STORE'),
    clusterId,
  };
}
