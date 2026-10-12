/**
 * @fileoverview The host key of an SSH window's authority, and the exact match of that key against the
 * configured aliases.
 */

/** The prefix of an SSH window's authority; the host key is what follows it, as written. */
const SSH_REMOTE_PREFIX = 'ssh-remote+';

/**
 * The host key of an authority: for an SSH window, everything after the prefix, as written (the spelling of an
 * alias, or the lower-case hex form of a typed user@host); a local, container, tunnel or virtual window has no
 * host key.
 */
export function hostKeyOfAuthority(authority: string): string | undefined {
  if (!authority.startsWith(SSH_REMOTE_PREFIX)) {
    return undefined;
  }
  return authority.slice(SSH_REMOTE_PREFIX.length);
}

/** Whether a configured alias equals the key exactly, case included. */
export function isConfiguredAlias(
  hostKey: string,
  aliases: readonly string[],
): boolean {
  return aliases.some(alias => alias === hostKey);
}
