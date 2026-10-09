/**
 * @fileoverview The line of an `ssh -v` run that says the connection is set up: the first setup report that ends
 * the connect wait (F-2105, F-2308 BR-5).
 */

/** A report in the client's output that the connection has reached a stage. */
export type SetupMarker = 'authenticated';

/** The start of the line `ssh` prints, without the debug prefix, when login succeeded. */
const AUTHENTICATED_START = 'Authenticated to ';

/** The text between the host and the method in that line. */
const AUTHENTICATED_METHOD = ' using "';

/** The marker a line of the client's error output carries, or undefined when it carries none. */
export function setupMarkerOf(line: string): SetupMarker | undefined {
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
