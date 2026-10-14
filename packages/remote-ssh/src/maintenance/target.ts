/**
 * @fileoverview The host named by a kill or uninstall command: the part of the typed target after the last at
 * sign and before a numeric port, the check that it is the window's own host, and the two notices as string
 * ids, never English text — the surface resolves them from the package's string table.
 */

import type {SshTarget} from 'lib-ssh';
import {payloadOf} from '../connect/connect-commands.ts';
import type {StringRef} from '../connect/picker-model.ts';

/**
 * The host of a typed target: the text after the last `@` (the whole text when there is none), and a trailing
 * `:` followed only by digits removed.
 */
export function hostPartOf(target: string): string {
  const host = target.slice(target.lastIndexOf('@') + 1);
  return host.replace(/:\d+$/, '');
}

/**
 * Whether the target is the window's own host: exact, case-sensitive equality of the target as given and the
 * window's authority host, the user and the port included. A different spelling of the same host is another host.
 */
export function isOwnHost(
  target: SshTarget,
  windowTarget: SshTarget | undefined,
): boolean {
  return (
    windowTarget !== undefined && payloadOf(target) === payloadOf(windowTarget)
  );
}

/** The notice that the server on the host was killed. */
export function killedNotice(host: string): StringRef {
  return {id: 'S085', values: [host]};
}

/** The notice that the kill could not run on the host. */
export function killFailedNotice(host: string): StringRef {
  return {id: 'S076', values: [host]};
}
