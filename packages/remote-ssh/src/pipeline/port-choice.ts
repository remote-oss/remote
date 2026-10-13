/**
 * @fileoverview The answer of the search for the window's local port, and the reason of a window whose configured
 * range had no free port: "Error establishing tunnel (Failed to find a free local port: No free ports in specified
 * range 'a-b'. ...)".
 */

import type {PortRange} from 'lib-forwarding';

/** A port the window can use, the configured range that had no free port, or no port when no range was searched. */
export type PortChoice =
  {port: number} | {busyRange: PortRange} | {noPort: true};

/** The reason of a connect whose configured range was busy: the tunnel's text, the search's and the range's. */
export function busyRangeReason(range: PortRange) {
  return {
    id: 'S067',
    values: [
      {
        id: 'S073',
        values: [
          {id: 'S095', values: [String(range.first), String(range.last)]},
        ],
      },
    ],
  } as const;
}
