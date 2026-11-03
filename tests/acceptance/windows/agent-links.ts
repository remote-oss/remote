/**
 * @fileoverview The agent links of the host: the form of their path, and a listing of them with their owners.
 */

import {onHost, onHostAs} from './harness.ts';

/** The form of an agent link's path. */
export const LINK_PATTERN = '/tmp/vscode-ssh-auth-sock-*';

/** The agent links in /tmp of the host, each with its owner, as `<owner> <path>`. */
export async function hostLinks(): Promise<string[]> {
  const listed = await onHost(
    'sh',
    '-c',
    `for name in ${LINK_PATTERN}; do [ -L "$name" ] && stat -c '%U %n' "$name"; done; true`,
  );
  return listed.split('\n').filter(line => line !== '');
}

/** The SSH_AUTH_SOCK the servers of `user` were started with, the socket sshd gave the session that started one. */
export async function serverSessionSocket(user = 'harness'): Promise<string> {
  return (
    await onHostAs(
      user,
      'sh',
      '-c',
      `for pid in $(pgrep -f '[.]vscodium-server-insiders/bin/'); do tr '\\0' '\\n' < /proc/$pid/environ 2>/dev/null | sed -n 's/^SSH_AUTH_SOCK=//p'; done | head -1`,
    )
  ).trim();
}

/**
 * The SSH_AUTH_SOCK of every extension host process of the servers of `user`, as they were started: what an extension
 * such as Git reads from its own environment.
 */
export async function extensionHostSockets(
  user = 'harness',
): Promise<string[]> {
  const listed = await onHostAs(
    user,
    'sh',
    '-c',
    `for pid in $(pgrep -f '[-]-type=extensionHost'); do tr '\\0' '\\n' < /proc/$pid/environ 2>/dev/null | sed -n 's/^SSH_AUTH_SOCK=//p'; done; true`,
  );
  return listed.split('\n').filter(line => line !== '');
}
