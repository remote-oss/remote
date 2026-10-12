/**
 * @fileoverview The Open Web UI address of the SSH window: the server's port on localhost, or nothing when no port
 * is known.
 */

/** The address Open Web UI opens for the server's port, or nothing when no port is known. */
export function webUiUrl(port: number | 'none'): string | undefined {
  return port === 'none' ? undefined : `http://localhost:${String(port)}/`;
}
