/**
 * @fileoverview The connect's named bounds on the host side and around the steps, and the connect timeout the probe
 * and the tunnel waits derive from.
 */

import type {ConnectionLimits} from 'lib-ssh';
import type {ServerBounds} from './parameters.ts';
import type {ConnectWaits} from './steps.ts';

/** Half an hour for the host's own download of the server, and a minute for a started server to listen. */
export const SERVER_BOUNDS: ServerBounds = {
  downloadSeconds: 30 * 60,
  readySeconds: 60,
};

/** How long the pre-connection script, with its question to the user, may take. */
export const PRECONNECT_MILLISECONDS = 5 * 60 * 1000;

/** How long one check of an `ssh` program, run with `-V`, may take. */
export const CLIENT_CHECK_MILLISECONDS = 30 * 1000;

/** The connect timeout of a host whose configuration sets 0, which waits on the system's own limit. */
export const HOST_ZERO_TIMEOUT_SECONDS = 600;

/** How long the shared connection's helper outlives its last window, long enough to carry a reload. */
export const HELPER_GRACE_MILLISECONDS = 3000;

/** How long the helper may take to answer one request over its local socket. */
const HELPER_REQUEST_MILLISECONDS = 10 * 1000;

/** The margin of the window's own login wait over the helper's, so the helper's timeout is heard first. */
const LOGIN_MARGIN_MILLISECONDS = 10 * 1000;

/** The default connect timeout, when neither the host nor the setting names one. */
const DEFAULT_TIMEOUT_SECONDS = 15;

/** The extra wait the extension adds to the connect timeout. */
const EXTRA_WAIT_SECONDS = 2;

/** A whole number of seconds from text, or nothing when the text is not one. */
function wholeSeconds(text: string): number | undefined {
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

/**
 * The connect timeout in seconds: the host's own, else the setting, else the default. A host's 0 gets the named
 * ceiling; the setting's 0 stays 0, which leaves only the extension's extra wait.
 */
export function effectiveConnectTimeoutSeconds(
  hostValue: string | undefined,
  settingValue: unknown,
): number {
  const host = hostValue === undefined ? undefined : wholeSeconds(hostValue);
  if (host !== undefined) {
    return host === 0 ? HOST_ZERO_TIMEOUT_SECONDS : host;
  }
  if (
    typeof settingValue === 'number' &&
    Number.isInteger(settingValue) &&
    settingValue >= 0
  ) {
    return settingValue;
  }
  return DEFAULT_TIMEOUT_SECONDS;
}

/** The probe's and the tunnel's waits for a connect timeout of `seconds`. */
export function connectWaitsFor(seconds: number): ConnectWaits {
  return {
    probeMilliseconds: (seconds + EXTRA_WAIT_SECONDS) * 1000,
    tunnelMilliseconds: (seconds === 0 ? EXTRA_WAIT_SECONDS : seconds) * 1000,
  };
}

/**
 * The window's waits on the helper: one reply, and the whole login. The login wait is the helper's own connect wait
 * plus a margin: a host's 0 waits the ceiling, the setting's 0 only the extra wait.
 */
export function connectionLimitsFor(
  hostValue: string | undefined,
  settingValue: unknown,
): ConnectionLimits {
  const helperWaitSeconds =
    hostValue !== undefined && wholeSeconds(hostValue) === 0
      ? HOST_ZERO_TIMEOUT_SECONDS
      : effectiveConnectTimeoutSeconds(hostValue, settingValue) +
        EXTRA_WAIT_SECONDS;
  return {
    requestMilliseconds: HELPER_REQUEST_MILLISECONDS,
    loginMilliseconds: helperWaitSeconds * 1000 + LOGIN_MARGIN_MILLISECONDS,
  };
}
