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
export {nodeFilePort} from './registry/node-file-port.ts';
export {claim} from './registry/claim.ts';
export {isStale, replaceStale} from './registry/stale.ts';
export {type Lease, type LeaseEvent, LeaseTable} from './runtime/leases.ts';
export {
  type PolicyOutcome,
  type Scheduler,
  EndPolicyRunner,
  PolicyError,
} from './runtime/end-policy.ts';
export type {
  EndpointConnection,
  EndpointPort,
  EndpointServer,
} from './endpoint/protocol.ts';
export {nodeEndpointPort} from './endpoint/node-endpoint.ts';
export {endpointPath, runtimeFolder} from './endpoint/path.ts';
export type {
  ClientMessage,
  HelperMessage,
  PlainData,
} from './endpoint/protocol.ts';
export {
  type HelperControl,
  type MessageHandler,
  type RequestContext,
  serve,
  type ServeEnd,
  type ServeOptions,
} from './runtime/serve.ts';
export {
  acquire,
  type AcquireFailure,
  type AcquireOutcome,
  type AcquireRequest,
  type ClientEnvironment,
  stop,
} from './client/acquire.ts';
export {
  type HelperEvent,
  HelperLease,
  type RequestOutcome,
  type Timer,
} from './client/lease.ts';
export {
  type ClientWaits,
  nodeClientEnvironment,
  nodeTimer,
} from './client/node-environment.ts';
export {
  type HelperParameters,
  type SpawnSpecification,
  type Spawner,
  spawnSpecification,
} from './client/spawn.ts';
export {
  helperParameters,
  inheritedEnvironment,
  runHelper,
} from './runtime/helper-main.ts';
