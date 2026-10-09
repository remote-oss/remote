/**
 * @fileoverview The host label of an SSH window: the host text alone, a port appended only after an IP address
 * literal, and the user never shown. The caller prefixes the label from its string table.
 */

import {isIP} from 'node:net';
import type {SshTarget} from 'lib-authority';

/** The host label of an SSH target: the host text, and a `:port` after an IP address literal that names a port. */
export function hostLabel(target: SshTarget): string {
  if (target.kind === 'plain') {
    return target.text;
  }
  const hostName = target.hostName.replace(/^\[([\s\S]*)\]$/, '$1');
  if (target.port === undefined || isIP(hostName) === 0) {
    return hostName;
  }
  return `${hostName}:${String(target.port)}`;
}
