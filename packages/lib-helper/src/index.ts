/**
 * @fileoverview lib-helper: one pattern for helper processes that outlive one window. Windows
 * claim a helper with an atomic exclusive create of a small record, hello to it with the record's
 * nonce, and hold leases numbered in arrival order; the oldest live lease is first. File access
 * goes through a port, so the decisions here are pure.
 */

export {
  type EndPolicy,
  type HelperRecord,
  RecordShapeError,
  parseRecord,
  serializeRecord,
} from './types.ts';
export {type RegistryFilePort, recordPath} from './registry/file-port.ts';
export {claim} from './registry/claim.ts';
export {isStale, replaceStale} from './registry/stale.ts';
