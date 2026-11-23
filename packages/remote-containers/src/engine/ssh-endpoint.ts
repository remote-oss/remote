/**
 * @fileoverview What an `ssh://` Docker endpoint names: its host part, and whether `ssh` would take that for an option.
 */

const SCHEME = /^ssh:\/\//i;

/**
 * The host part of an `ssh://` endpoint, whose scheme is matched in any case: the authority is the text after the scheme
 * up to the first `/`; the host follows the last `@` of the authority and ends at the first `:`, and an IPv6 address in
 * brackets is taken whole. None for any other endpoint.
 */
export function sshHostOf(endpoint: string): string | undefined {
  const scheme = SCHEME.exec(endpoint);
  if (scheme === null) {
    return undefined;
  }
  const rest = endpoint.slice(scheme[0].length);
  const slash = rest.indexOf('/');
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close < 0 ? host : host.slice(0, close + 1);
  }
  const colon = host.indexOf(':');
  return colon < 0 ? host : host.slice(0, colon);
}

/** The host part of `endpoint` when it is an `ssh://` endpoint whose host starts with a dash. */
export function dashHostOf(endpoint: string | undefined): string | undefined {
  const host = endpoint === undefined ? undefined : sshHostOf(endpoint);
  return host?.startsWith('-') === true ? host : undefined;
}
