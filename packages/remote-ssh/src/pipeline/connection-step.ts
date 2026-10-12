/**
 * @fileoverview The connection step of a connect over the shared connection's client: take a lease on the host's
 * helper, let the window hear its questions while the login runs, and hand the pipeline the channel for the server
 * steps. A failure gives the lease back, so the helper can end.
 */

import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
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
    input: ConnectInput,
  ) => HostChannel;
  /**
   * Shows the login's questions to the user and passes the answers on, from the acquire until the login ends; the
   * returned handle takes the questions down.
   */
  attachLogin: (login: LoginLease, input: ConnectInput) => {dispose(): void};
  logger: Logger;
}

/** What the window's questions need of the connection: its notices, and the answer or the refusal of each. */
export interface LoginLease {
  /** Calls `listener` for each notice until the returned function is called. */
  onNotice(listener: (notice: ConnectionNotice) => void): () => void;
  /** Gives the answer to a question; false when another answer was first or the question is gone. */
  answer(promptId: number, text: string): Promise<boolean>;
  /**
   * Refuses a question the user dismissed. The helper closes it unanswered, marks the attempt cancelled and refuses
   * every later question of that ssh run without telling the windows.
   */
  refuse(promptId: number): Promise<boolean>;
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
      if (acquired.failure !== 'cancelled') {
        dependencies.logger.warn(
          `the connection helper could not be reached or started: ${acquired.failure}`,
        );
      }
      return {kind: 'failed', failure: ofAcquire(acquired.failure)};
    }
    const {connection} = acquired;
    function end(): void {
      connection.release();
    }
    const login = dependencies.attachLogin(connection, input);
    let outcome: Awaited<ReturnType<SharedConnection['connect']>>;
    try {
      outcome = await connection.connect(cancellation);
    } finally {
      login.dispose();
    }
    if (outcome.kind === 'failed') {
      end();
      return {kind: 'failed', failure: ofConnection(outcome.failure)};
    }
    let channel: HostChannel;
    try {
      channel = dependencies.channelFor(connection, terms, input);
    } catch (caught) {
      end();
      return {
        kind: 'failed',
        failure: {kind: 'unknown', logDetail: String(caught)},
      };
    }
    return {
      kind: 'done',
      value: {
        channel,
        socksPort: outcome.socksPort,
        storeSharedRecord: record => connection.storeSharedRecord(record),
        onNotice: listener => connection.onNotice(listener),
        answer: (promptId, text) => connection.answer(promptId, text),
        refuse: promptId => connection.refuse(promptId),
        release: end,
      },
    };
  };
}
