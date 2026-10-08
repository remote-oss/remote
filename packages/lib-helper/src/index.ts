/**
 * @fileoverview lib-helper: the shared pattern for helper processes that outlive one window.
 */

export {
  claim,
  type ClaimOutcome,
  parseRecord,
  RecordShapeError,
  recordPath,
  serializeRecord,
} from './registry/claim.ts';
export type {RegistryFilePort} from './registry/file-port.ts';
export {type HelloResult, isStale, replaceStale} from './registry/stale.ts';
export {
  EndPolicyRunner,
  PolicyError,
  type PolicyOutcome,
  type Scheduler,
} from './runtime/end-policy.ts';
export {type Lease, type LeaseEvent, LeaseTable} from './runtime/leases.ts';
export type {EndPolicy, HelperRecord} from './types.ts';
