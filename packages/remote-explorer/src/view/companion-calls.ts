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
  readEnvelope,
  readHostnames,
  SSH_ENDPOINTS,
  type Versioned,
  writeEnvelope,
  writeOpenRequest,
} from 'lib-companion';

/** Which window a host opens in. */
export type WindowTarget = 'current' | 'new';

/** The companion calls of the view. */
export interface CompanionCalls {
  activeRemote(): Promise<CallOutcome<ActiveRemote>>;
  hostnames(): Promise<CallOutcome<Hostnames>>;
  open(hostKey: string, target: WindowTarget): Promise<CallOutcome<Versioned>>;
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
    open: (hostKey, target) =>
      protocol.call(
        SSH_ENDPOINTS.openRemoteSshTarget.commandId,
        writeOpenRequest({hostKey, window: target}),
        readEnvelope,
      ),
  };
}
