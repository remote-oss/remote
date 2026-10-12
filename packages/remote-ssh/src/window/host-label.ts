/**
 * @fileoverview The host label of an SSH window: the host text alone, a port appended only after an IP address
 * literal, and the user never shown. The caller prefixes the label from its string table.
 */

import {isIP} from 'node:net';
import type {SshTarget} from 'lib-authority';
import {parseTypedHost} from '../connect/typed-input.ts';

/**
 * The host label of an SSH target: the host text, and a `:port` after an IP address literal that names a port; an IPv6
 * literal is in brackets before its port.
 */
export function hostLabel(target: SshTarget): string {
  if (target.kind === 'plain') {
    const {host, port} = parseTypedHost(target.text);
    return hostLabel({
      kind: 'host',
      hostName: host,
      ...(port === undefined ? {} : {port}),
    });
  }
  const hostName = target.hostName.replace(/^\[([\s\S]*)\]$/, '$1');
  if (target.port === undefined || isIP(hostName) === 0) {
    return hostName;
  }
  const shown = isIP(hostName) === 6 ? `[${hostName}]` : hostName;
  return `${shown}:${String(target.port)}`;
}
