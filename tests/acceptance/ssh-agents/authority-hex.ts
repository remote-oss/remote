/**
 * @fileoverview The payload of an `ssh-remote+` authority in its hexadecimal form: the lower-case hex of the UTF-8
 * bytes of a compact JSON object whose keys come in the order `hostName`, `user`, `port`.
 */

/** The target an authority names: the port is left out when the target has none. */
export interface AuthorityTarget {
  hostName: string;
  user: string;
  port?: number;
}

/** The hexadecimal payload of `target`, the port a JSON number. */
export function authorityHex(target: AuthorityTarget): string {
  const object =
    target.port === undefined
      ? {hostName: target.hostName, user: target.user}
      : {hostName: target.hostName, user: target.user, port: target.port};
  return Buffer.from(JSON.stringify(object), 'utf8').toString('hex');
}
