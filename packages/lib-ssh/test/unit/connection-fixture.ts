/**
 * @fileoverview What the tests of the shared connection share: the `ssh` request the helper is given and the line
 * `ssh -v` prints when the login is done.
 */

import type {SshRequest} from '../../src/index.ts';

/** The line of `ssh -v` that says the login succeeded. */
export const AUTHENTICATED =
  'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".\n';

/** The `ssh` run of a connection to the host `harness`. */
export const SSH_REQUEST: SshRequest = {
  purpose: 'connection',
  target: {host: 'harness'},
  settings: {
    configFile: '',
    connectTimeout: 15,
    permitPtyAllocation: false,
    remoteCommandInEffect: false,
  },
  effective: {
    hostName: 'harness',
    user: 'dev',
    port: '22',
    localForwards: [],
  },
  programs: {sshProgram: 'ssh', scpProgram: 'scp'},
  homeFolder: '/home/dev',
  platform: 'linux',
};
