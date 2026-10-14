/**
 * @fileoverview The lines of an `ssh -v` run that say the connection has reached a stage: the handshake, and the
 * login line that ends the connect wait.
 */

/** A report in the client's output that the connection has reached a stage. */
export type SetupMarker = 'handshake' | 'authenticated';

/** The line `ssh -v` prints when the key exchange ends: the connection is set up and questions may follow. */
const HANDSHAKE_LINE = 'debug1: SSH2_MSG_NEWKEYS received';

/** The start of the line `ssh` prints, without the debug prefix, when login succeeded. */
const AUTHENTICATED_START = 'Authenticated to ';

/** The line a mux client prints once the master has accepted its session request: its session runs as a login's would. */
const MUX_SESSION_START =
  'debug1: mux_client_request_session: master session id: ';

/** The text between the host and the method in that line. */
const AUTHENTICATED_METHOD = ' using "';

/** The marker a line of the client's error output carries, or undefined when it carries none. */
export function setupMarkerOf(line: string): SetupMarker | undefined {
  if (line.replace(/\r$/, '') === HANDSHAKE_LINE) {
    return 'handshake';
  }
  if (line.replace(/\r$/, '').startsWith(MUX_SESSION_START)) {
    return 'authenticated';
  }
  return line.startsWith(AUTHENTICATED_START) &&
    line.includes(AUTHENTICATED_METHOD)
    ? 'authenticated'
    : undefined;
}

/** The first marker among the lines, in the order the client wrote them. */
export function firstSetupMarker(
  lines: readonly string[],
): SetupMarker | undefined {
  for (const line of lines) {
    const marker = setupMarkerOf(line);
    if (marker !== undefined) {
      return marker;
    }
  }
  return undefined;
}
