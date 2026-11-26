/**
 * @fileoverview The relay's settings as the unit rows run it.
 */

import type {RelayConfig} from '../../src/config.ts';

/** The settings of the rows: an in-memory store and one cluster. */
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
};
