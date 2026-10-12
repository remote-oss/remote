/**
 * @fileoverview When the default forwards are applied: on a connection of its own, not on a reconnection.
 */

/** Whether the default forwards are applied to this resolve; a retry of the first connection counts as one. */
export function shouldApplyDefaults(isReconnection: boolean): boolean {
  return !isReconnection;
}
