/**
 * @fileoverview The removal of an entry's copies from the open history of one host: a new list, the surviving
 * entries in order, and whether anything was removed.
 */

import type {HostHistory} from './payloads.ts';

/** What the removal left: the hosts list with the removed entries gone, and whether anything was removed. */
export interface RemovalOutcome {
  hosts: HostHistory[];
  changed: boolean;
}

/**
 * The hosts with every entry whose path equals the given path exactly (whatever its kind) removed from the
 * host whose key equals the given key exactly, and from no other host; the order of the hosts and of the
 * remaining entries is kept, a host whose last entry is removed stays with no entries, and the input is
 * never changed.
 */
export function removeFolderCopies(
  hosts: readonly HostHistory[],
  hostKey: string,
  path: string,
): RemovalOutcome {
  let changed = false;
  const result = hosts.map(host => {
    if (host.hostKey !== hostKey) {
      return host;
    }
    const remaining = host.entries.filter(entry => entry.path !== path);
    if (remaining.length === host.entries.length) {
      return host;
    }
    changed = true;
    return {hostKey: host.hostKey, entries: remaining};
  });
  return {hosts: result, changed};
}
