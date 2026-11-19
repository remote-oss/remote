/**
 * @fileoverview The error hint of an install that stopped for a program the host does not have, `tar` or `gzip`: that
 * a command was not found, and the steps to take, to install the program and to put it on the login `PATH`.
 */

import type {FailureHint} from 'lib-ssh';

/** The name of the variable the host finds its programs by, as the last step names it. */
const PATH_VARIABLE = 'PATH';

/** The hint for a host without `program`, its texts left to the recorder, which writes them in the display language. */
export function commandMissingHint(program: string): FailureHint {
  return {
    status: 'CommandMissing',
    message: {id: 'S004', values: []},
    mitigations: [
      {id: 'S083', values: [program]},
      {id: 'S062', values: [PATH_VARIABLE]},
    ],
    resources: [],
  };
}
