/**
 * @fileoverview The error hint of a host that does not meet the server's prerequisites for glibc and libstdc++: that it
 * may not, why the connect failed, and the one step to take, STR:S165, which is the address of our page about old Linux
 * hosts. The hint points to the page about what a Linux host needs.
 */

import {LINUX_PREREQUISITES_TOPIC, type FailureHint} from 'lib-ssh';

/** The address of the page about what a Linux host needs for the server, the same in every display language. */
export const LINUX_PREREQUISITES_PAGE =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-ssh/linux-prerequisites.md';

/** The hint for a host the server's requirements check refused, its texts left to the recorder. */
export function prerequisitesHint(): FailureHint {
  return {
    status: 'LinuxPrereqs',
    message: {id: 'S145', values: []},
    details: {id: 'S144'},
    mitigations: [{id: 'S165', values: []}],
    resources: [LINUX_PREREQUISITES_TOPIC],
  };
}
