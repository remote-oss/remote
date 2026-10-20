/**
 * @fileoverview The signal to Remote Explorer that the configured hosts may have changed: one signal per event, with
 * no debounce, and none when it cannot be delivered.
 */

import {EXPLORER_INBOX, type Protocol, writeEnvelope} from 'lib-companion';

/** Sends the signal that the configured hosts changed, and forgets it. */
export function signalHostsChanged(protocol: Protocol): void {
  protocol.fireAndForget(
    EXPLORER_INBOX.sshHostsChanged.commandId,
    writeEnvelope(),
  );
}
