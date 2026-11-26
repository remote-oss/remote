/**
 * @fileoverview The dev tunnels contract's rules for what a client may write: tunnel ids, names, labels and
 * descriptions (`[dev-tunnels] rs/src/contracts/tunnel_constraints.rs`). The relay accepts exactly what the SDKs'
 * patterns allow and nothing else.
 */

/** A tunnel id: the old 8-character form or the new one of 3 to 49 characters (`tunnel_constraints.rs:111,122`). */
const TUNNEL_ID =
  /^(?:[0123456789bcdfghjklmnpqrstvwxz]{8}|[a-z0-9][a-z0-9-]{1,47}[a-z0-9])$/;

/** A tunnel name: 3 to 49 characters starting and ending with a letter or digit (`:140`). */
const TUNNEL_NAME = /^[a-z0-9][a-z0-9-]{1,47}[a-z0-9]$/;

/** A label: 1 to 50 word characters, hyphens and equals signs (`:143`). */
const LABEL = /^[\w\-=]{1,50}$/;

/** The most labels a tunnel holds (`:59`). */
export const MAX_LABELS = 100;

/** The longest description (`:41`). */
export const MAX_DESCRIPTION = 400;

/** A cluster id (`:101`). */
const CLUSTER_ID = /^(?:[a-z]{3,4}[0-9]{1,3}|asse|aue|brs|euw|use)$/;

/** Whether `value` is a tunnel id the contract allows. */
export function isTunnelId(value: string): boolean {
  return TUNNEL_ID.test(value);
}

/** Whether `value` is a tunnel name the contract allows; the empty name is allowed. Names compare in lower case. */
export function isTunnelName(value: string): boolean {
  return value === '' || TUNNEL_NAME.test(value.toLowerCase());
}

/** Whether every one of `labels` is allowed and there are not too many. */
export function areLabels(labels: readonly unknown[]): boolean {
  return (
    labels.length <= MAX_LABELS &&
    labels.every(label => typeof label === 'string' && LABEL.test(label))
  );
}

/** Whether `value` is a cluster id the contract allows. */
export function isClusterId(value: string): boolean {
  return CLUSTER_ID.test(value);
}
