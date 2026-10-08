/**
 * @fileoverview A valid helper record for the registry tests.
 */

import type {HelperRecord} from '../../src/index.ts';

/** A record of the `ssh.connection` namespace with one payload value of each kind. */
export function sampleRecord(nonce = 'nonce-1'): HelperRecord {
  return {
    version: 1,
    namespace: 'ssh.connection',
    subject: 'user@host:22',
    endpoint: '/run/helper.sock',
    nonce,
    processId: 4242,
    startedAt: 1_700_000_000_000,
    payload: {port: 49152, host: 'host', shared: true},
  };
}
