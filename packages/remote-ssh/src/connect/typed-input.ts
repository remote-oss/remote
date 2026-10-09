/**
 * @fileoverview The typed host text of the picker, as the connection target the validator and the codec read it:
 * the user before the last at sign, the port the text names, and the address behind brackets, nothing else.
 */

import {isIPv6} from 'node:net';
import type {SshTarget} from 'lib-ssh';

/** The target with the user and the port only where the call names them. */
function targetOf(
  host: string,
  user: string | undefined,
  port?: number,
): SshTarget {
  const target: SshTarget = {host};
  if (user !== undefined) {
    target.user = user;
  }
  if (port !== undefined) {
    target.port = port;
  }
  return target;
}

/** The user before the last at sign and the host part after it; a text that ends with the at sign has no user. */
function userAndHostPart(text: string): {
  user: string | undefined;
  hostPart: string;
} {
  const atSign = text.lastIndexOf('@');
  if (atSign < 0) {
    return {user: undefined, hostPart: text};
  }
  const hostPart = text.slice(atSign + 1);
  if (hostPart === '') {
    return {user: undefined, hostPart: text};
  }
  const user = atSign === 0 ? undefined : text.slice(0, atSign);
  return {user, hostPart};
}

/** The address behind the brackets of a host part, when it is IPv6, and the port the part still names. */
function bracketed(
  hostPart: string,
): {address: string; port: number | undefined} | null {
  const brackets = /^\[([^\]]*)\](?::(\d+))?$/.exec(hostPart);
  if (brackets !== null) {
    const address = brackets[1] ?? '';
    if (isIPv6(address)) {
      const portText = brackets[2];
      return {
        address,
        port: portText === undefined ? undefined : Number(portText),
      };
    }
  }
  return null;
}

/** The typed host text, as typed: no trimming, no case change, and nothing the validator has not seen. */
export function parseTypedHost(text: string): SshTarget {
  const {user, hostPart} = userAndHostPart(text);
  const address = bracketed(hostPart);
  if (address !== null) {
    return targetOf(address.address, user, address.port);
  }
  if (isIPv6(hostPart)) {
    return targetOf(hostPart, user);
  }
  const port = /:(\d+)$/.exec(hostPart);
  if (port !== null) {
    return targetOf(
      hostPart.slice(0, hostPart.length - port[0].length),
      user,
      Number(port[1]),
    );
  }
  return targetOf(hostPart, user);
}
