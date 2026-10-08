/**
 * @fileoverview Maps a resolver failure to the outcome the host gives core, first match winning.
 */

/** The failure the connector reports, in the shape the host checks; the kind itself is never read here. */
export interface FailedLike {
  kind: string;
  retryable: boolean;
  isReconnection: boolean;
  silent: boolean;
  userAlreadyNotified: boolean;
}

/** The outcome the resolver host gives core for a failure. */
export type ResolverOutcome =
  | {kind: 'temporarilyNotAvailable'}
  | {kind: 'notAvailable'; handled: boolean}
  | {kind: 'presenter'};

/**
 * Maps a failure to the host's outcome, in the contract's order: retryable, then a reconnection, then a silent
 * failure, then a failure the user was already told about; anything else waits for the presenter.
 */
export function mapFailure(failed: FailedLike): ResolverOutcome {
  if (failed.retryable) {
    return {kind: 'temporarilyNotAvailable'};
  }
  if (failed.isReconnection || failed.silent) {
    return {kind: 'notAvailable', handled: false};
  }
  if (failed.userAlreadyNotified) {
    return {kind: 'notAvailable', handled: true};
  }
  return {kind: 'presenter'};
}
