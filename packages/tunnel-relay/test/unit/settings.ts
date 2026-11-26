/**
 * @fileoverview The relay's settings as the unit rows run it.
 */

import type {RelayConfig} from '../../src/config.ts';

/** The settings of the rows: an in-memory store, one cluster and every limit at ten. */
export const TEST_CONFIG: RelayConfig = {
  domain: 'relay.test',
  port: 443,
  certificateFile: '',
  keyFile: '',
  storeFile: ':memory:',
  clusterId: 'usw2',
  githubApi: 'https://github.test',
  allowlistFile: '',
  tokenKeyFile: '',
  limits: {tunnels: 10, ports: 10, clients: 10},
};
