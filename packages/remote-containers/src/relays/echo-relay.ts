/**
 * @fileoverview The harness's own relay kind: a stream whose host end writes back what it reads. It exists only while
 * the acceptance switch and its own variable are both on, so a shipped build never sets it up.
 */

import {harnessAdapterOn} from '../acceptance-switch.ts';
import type {RelayKind} from './relay-host.ts';
import type {HostEnd} from './relay-session.ts';

/** The variable that turns the echo relay on in the harness. */
const ECHO_SWITCH = 'REMOTE_OSS_ACCEPTANCE_RELAY_ECHO';

/** The variable that carries the echo relay's socket path into the container. */
export const ECHO_VARIABLE = 'REMOTE_OSS_RELAY_ECHO_SOCK';

/** A host end that writes back what it reads, until it ends. */
function echoEnd(): HostEnd {
  const dataListeners: Array<(bytes: Uint8Array) => void> = [];
  let ended = false;
  return {
    write: bytes => {
      if (!ended) {
        for (const listener of dataListeners) {
          listener(bytes);
        }
      }
      return true;
    },
    onData: listener => {
      dataListeners.push(listener);
    },
    onDrain: () => undefined,
    onClose: () => undefined,
    end: () => {
      ended = true;
    },
  };
}

/** The harness's relay kinds for `environment`: the echo relay when it's on, else none. */
export function harnessRelayKindsOf(
  environment: Readonly<Record<string, string | undefined>>,
): RelayKind[] {
  return harnessAdapterOn(environment, ECHO_SWITCH)
    ? [
        {
          kind: 'echo',
          variable: ECHO_VARIABLE,
          connect: () => Promise.resolve(echoEnd()),
        },
      ]
    : [];
}
