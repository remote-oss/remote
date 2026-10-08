/**
 * @fileoverview The record a helper process leaves in the registry, and the policies that decide when it ends.
 */

/** What the registry holds for one running helper: where to reach it, how to recognise it, and its own data. */
export interface HelperRecord {
  version: 1;
  /** The kind of helper, such as one per connection type; records of one kind share a folder. */
  namespace: string;
  /** What the helper serves, unique within its namespace. The registry never shows it in a file name. */
  subject: string;
  endpoint: string;
  /** The value the helper repeats in its hello, so that a client knows it reached the helper it recorded. */
  nonce: string;
  processId: number;
  startedAt: number;
  /** The helper's own facts; plain values only, and never a secret. */
  payload: Record<string, string | number | boolean>;
}

/** When a helper ends once its last lease has closed. */
export type EndPolicy =
  | {kind: 'graceAfterLastLease'; milliseconds: number}
  | {kind: 'delayedCheckAfterLastLease'; milliseconds: number; action: string}
  | {kind: 'idleAfterLastLease'; milliseconds: number};
