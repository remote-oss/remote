/**
 * @fileoverview The two questions a build of the view asks the SSH companion: whether the window is connected, and
 * which hosts are configured. Each is a fresh call of the versioned protocol.
 */

import {
  type ActiveRemote,
  type CallOutcome,
  type Hostnames,
  type Protocol,
  readActiveRemote,
  readHostnames,
  SSH_ENDPOINTS,
  writeEnvelope,
} from 'lib-companion';

/** The companion calls of a build of the view. */
export interface CompanionCalls {
  activeRemote(): Promise<CallOutcome<ActiveRemote>>;
  hostnames(): Promise<CallOutcome<Hostnames>>;
}

/** The calls over the protocol; each makes a fresh envelope. */
export function companionCallsOf(
  protocol: Pick<Protocol, 'call'>,
): CompanionCalls {
  return {
    activeRemote: () =>
      protocol.call(
        SSH_ENDPOINTS.getActiveSshRemote.commandId,
        writeEnvelope(),
        readActiveRemote,
      ),
    hostnames: () =>
      protocol.call(
        SSH_ENDPOINTS.getConfiguredHostnames.commandId,
        writeEnvelope(),
        readHostnames,
      ),
  };
}
