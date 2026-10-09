/**
 * @fileoverview Decides, from the host's effective options, whether the family may still use one of its own
 * forwarding paths before any `ssh` runs.
 */

import type {EffectiveOptions} from './effective.ts';

/** The forwarding path being checked. */
export type ForwardingPath = 'socks' | 'secondSsh' | 'socket';

/** Whether the path is allowed, or the reason that forbids it. */
export type ForwardingBlock =
  {blocked: false} | {blocked: true; reason: 'clearAllForwardings'};

/**
 * The block for one path of the effective options: the option forbids only the SOCKS forward, which rides the
 * `ssh` the option applies to; the family's own tunnel `ssh` is started with its own forward.
 */
export function forwardingBlock(
  options: Pick<EffectiveOptions, 'clearAllForwardings'>,
  path: ForwardingPath,
): ForwardingBlock {
  if (options.clearAllForwardings && path === 'socks') {
    return {blocked: true, reason: 'clearAllForwardings'};
  }
  return {blocked: false};
}
