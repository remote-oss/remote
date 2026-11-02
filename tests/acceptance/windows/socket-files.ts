/**
 * @fileoverview The server sockets of the host's `/tmp`, `/tmp/code-<uuid>`, of one account: `/tmp` is sticky and shared
 * by the host's accounts, so a row that removes or counts sockets reads only the files its own account owns.
 */

import {onHost} from './harness.ts';

/** The lines of a command's output that are not empty. */
function linesOf(output: string): string[] {
  return output.split('\n').filter(line => line !== '');
}

/** Removes the `/tmp/code-<uuid>` files of the user `user`, listening or not. */
export async function removeOwnSockets(user = 'harness'): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `find /tmp -maxdepth 1 -user ${user} -name 'code-*' -delete`,
  );
}

/** The sockets of the user `user`'s server in the host's `/tmp`, as `/tmp/code-<uuid>`, that the kernel lists as listening. */
export async function listeningSockets(user = 'harness'): Promise<string[]> {
  return linesOf(
    await onHost(
      'sh',
      '-c',
      `for path in $(awk '$4=="00010000" && $8 ~ /^\\/tmp\\/code-/ {print $8}' /proc/net/unix); do [ "$(stat -c %U "$path")" = ${user} ] && echo "$path"; done; true`,
    ),
  ).sort();
}

/** The files `/tmp/code-<uuid>` of the user `user` in the host's `/tmp`, whatever their type, in name order. */
export async function socketFiles(user = 'harness'): Promise<string[]> {
  return linesOf(
    await onHost(
      'sh',
      '-c',
      `find /tmp -maxdepth 1 -user ${user} -name 'code-*'; true`,
    ),
  ).sort();
}
