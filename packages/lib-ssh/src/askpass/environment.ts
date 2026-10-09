/**
 * @fileoverview The variables that make `ssh` run our askpass program. `SSH_ASKPASS_REQUIRE=force` goes with them
 * and only with them, because OpenSSH runs an askpass without a terminal only when a display is set or the use is
 * forced. A user's own askpass is left alone: it gets neither that variable nor a `DISPLAY` from us.
 */

import {ENDPOINT_VARIABLE, NONCE_VARIABLE} from './program.ts';

/** Where our askpass is, and whether the user's own takes its place. */
export interface AskpassEnvironmentRequest {
  /** The launcher script that `ssh` runs. */
  launcher: string;
  /** The helper's askpass endpoint. */
  endpoint: string;
  nonce: string;
  /** Whether the user's own askpass applies: shared mode, `remote.SSH.externalSSH_ASKPASS` on and a non-empty value. */
  external: boolean;
}

/** The variables to add to the environment of an `ssh` run; none when the user's own askpass applies. */
export function askpassEnvironment(
  request: AskpassEnvironmentRequest,
): Record<string, string> {
  if (request.external) {
    return {};
  }
  return {
    SSH_ASKPASS: request.launcher,
    SSH_ASKPASS_REQUIRE: 'force',
    [ENDPOINT_VARIABLE]: request.endpoint,
    [NONCE_VARIABLE]: request.nonce,
  };
}
