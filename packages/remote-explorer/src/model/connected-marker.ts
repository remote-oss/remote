/**
 * @fileoverview The "connected" mark of a host row: the row of the window's own SSH host is marked, decided by the
 * answer of the pull alone. Nothing the companion pushes can mark a row.
 */

import type {HostRow} from './ssh-group.ts';

/** The answer of the first call of a build: whether the window is connected, and the alias it connected by. */
export interface ActivePull {
  connected: boolean;
  hostKey?: string;
}

/** What the view applies to a marked row: the string id of its description and the name of its icon. */
export const CONNECTED_MARKER = {
  descriptionId: 'S003',
  icon: 'vm-active',
} as const;

/**
 * The id of the first row whose alias is the pull's host key, exactly, when the pull says the window is connected;
 * nothing for a pull that failed, a local window or an alias that names no row.
 */
export function markedRowIds(
  rows: readonly HostRow[],
  pull: ActivePull | undefined,
): string[] {
  if (pull === undefined || !pull.connected || pull.hostKey === undefined) {
    return [];
  }
  const marked = rows.find(row => row.alias === pull.hostKey);
  return marked === undefined ? [] : [marked.rowId];
}
