/**
 * @fileoverview The connection step of a connect over the shared connection's client: take a lease on the host's
 * helper, let the window hear its questions while the login runs, and hand the pipeline the channel for the server
 * steps. A failure gives the lease back, so the helper can end.
 */

import type {HostChannel} from 'lib-host';
import type {
  AcquireConnectionOutcome,
  ConnectionAcquireRequest,
  ConnectionNotice,
  SharedConnection,
} from 'lib-ssh';
import {ofAcquire, ofConnection} from './failure.ts';
import type {ConnectInput, ConnectionTerms, ConnectSteps} from './steps.ts';

/** What the connection step is made from. */
export interface ConnectionStepDependencies {
  /** Takes a lease on the helper of a host; the real one is `acquireConnection` over the window's environment. */
  acquire: (
    request: ConnectionAcquireRequest,
  ) => Promise<AcquireConnectionOutcome>;
  /**
   * What the acquire is asked for, apart from the host string and the cancellation: the helper to start, its start
   * values with the `ssh` request built for these terms, and its end policy.
   */
  requestFor: (
    input: ConnectInput,
    terms: ConnectionTerms,
  ) => Omit<ConnectionAcquireRequest, 'hostString' | 'cancellation'>;
  /** The channel for the server steps over the connection that is set up, for the platform the terms say. */
  channelFor: (
    connection: SharedConnection,
    terms: ConnectionTerms,
  ) => HostChannel;
  /** Hears the questions and the other notices of the login while the connect waits for it. */
  onNotice: (notice: ConnectionNotice) => void;
}

/** The step that opens the connection of a connect. */
export function openConnectionStep(
  dependencies: ConnectionStepDependencies,
): ConnectSteps['openConnection'] {
  return async (input, terms, cancellation) => {
    const acquired = await dependencies.acquire({
      ...dependencies.requestFor(input, terms),
      hostString: input.rawHostString,
      cancellation,
    });
    if (acquired.kind === 'failed') {
      return {kind: 'failed', failure: ofAcquire(acquired.failure)};
    }
    const {connection} = acquired;
    const stopListening = connection.onNotice(dependencies.onNotice);
    function end(): void {
      stopListening();
      connection.release();
    }
    const outcome = await connection.connect(cancellation);
    if (outcome.kind === 'failed') {
      end();
      return {kind: 'failed', failure: ofConnection(outcome.failure)};
    }
    return {
      kind: 'done',
      value: {
        channel: dependencies.channelFor(connection, terms),
        socksPort: outcome.socksPort,
        storeSharedRecord: record => connection.storeSharedRecord(record),
        release: end,
      },
    };
  };
}
