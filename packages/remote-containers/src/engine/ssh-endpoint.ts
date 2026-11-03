/**
 * @fileoverview What an `ssh://` Docker endpoint names: its host part, and whether `ssh` would take that for an option.
 */

const SCHEME = 'ssh://';

/**
 * The host part of an `ssh://` endpoint: the text after the scheme, after the last `@` if there is one, up to the first
 * `:` or `/`; an IPv6 address in brackets is taken whole. None for any other endpoint.
 */
export function sshHostOf(endpoint: string): string | undefined {
  if (!endpoint.startsWith(SCHEME)) {
    return undefined;
  }
  const authority = endpoint.slice(SCHEME.length);
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    return close < 0 ? host : host.slice(0, close + 1);
  }
  const end = host.search(/[:/]/);
  return end < 0 ? host : host.slice(0, end);
}

/** The host part of `endpoint` when it is an `ssh://` endpoint whose host starts with a dash. */
export function dashHostOf(endpoint: string | undefined): string | undefined {
  const host = endpoint === undefined ? undefined : sshHostOf(endpoint);
  return host?.startsWith('-') === true ? host : undefined;
}
