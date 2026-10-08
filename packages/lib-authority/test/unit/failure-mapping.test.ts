import {deepStrictEqual} from 'node:assert';
import {mapFailure, type FailedLike} from '../../src/index.ts';

/** A failure with every flag set; the table rows clear the flags they clear. */
function allSet(): FailedLike {
  return {
    kind: 'channelClosed',
    retryable: true,
    isReconnection: true,
    silent: true,
    userAlreadyNotified: true,
  };
}

describe('mapFailure (card authority-02 table)', () => {
  it('retryable -> temporarilyNotAvailable, first match wins', () => {
    deepStrictEqual(mapFailure(allSet()), {kind: 'temporarilyNotAvailable'});
  });

  it('isReconnection -> notAvailable handled false', () => {
    const failed = allSet();
    failed.retryable = false;
    deepStrictEqual(mapFailure(failed), {kind: 'notAvailable', handled: false});
  });

  it('silent -> notAvailable handled false', () => {
    const failed = allSet();
    failed.retryable = false;
    failed.isReconnection = false;
    deepStrictEqual(mapFailure(failed), {kind: 'notAvailable', handled: false});
  });

  it('userAlreadyNotified -> notAvailable handled true', () => {
    const failed = allSet();
    failed.retryable = false;
    failed.isReconnection = false;
    failed.silent = false;
    deepStrictEqual(mapFailure(failed), {kind: 'notAvailable', handled: true});
  });

  it('all false -> presenter', () => {
    const failed = allSet();
    failed.retryable = false;
    failed.isReconnection = false;
    failed.silent = false;
    failed.userAlreadyNotified = false;
    deepStrictEqual(mapFailure(failed), {kind: 'presenter'});
  });

  it('kind is never read -> an unknown kind string gives the same results', () => {
    const unknownKind = {
      kind: 'not-a-known-kind',
      retryable: false,
      isReconnection: false,
      silent: false,
      userAlreadyNotified: false,
    };
    deepStrictEqual(mapFailure(unknownKind), {kind: 'presenter'});
  });
});
