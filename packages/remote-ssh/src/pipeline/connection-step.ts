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
  RunFacts,
  SharedConnection,
} from 'lib-ssh';
import type {PhaseEvent} from './connect.ts';
import {ofAcquire, ofConnection} from './failure.ts';
import type {
  ConnectInput,
  ConnectionTerms,
  ConnectSteps,
  ConnectWaits,
  StepFailure,
} from './steps.ts';

/** What the connection step is made from. */
export interface ConnectionStepDependencies {
  /** Takes a lease on the helper of a host; the real one is `acquireConnection` over the window's environment. */
  acquire: (
    request: ConnectionAcquireRequest<StepFailure>,
  ) => Promise<AcquireConnectionOutcome<StepFailure>>;
  /**
   * What the acquire is asked for, apart from the host string and the cancellation: the helper to start, its end
   * policy, and the preparation of its start values, which looks the client up and runs only when this window starts
   * the helper.
   */
  requestFor: (
    input: ConnectInput,
    terms: ConnectionTerms,
  ) => Omit<
    ConnectionAcquireRequest<StepFailure>,
    'hostString' | 'cancellation'
  >;
  /**
   * Keeps what the window that started the helper found, for a window that joined it and looked nothing up; nothing
   * is changed in a window that did.
   */
  adoptRunFacts: (runFacts: RunFacts) => void;
  /** The waits the host asks for, once the connection is set up and the lookup's results are in. */
  waits: () => ConnectWaits;
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
  /** Reports a stage of the connect to the progress. */
  onPhase: (event: PhaseEvent) => void;
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
      hostString: input.connectionKey ?? input.rawHostString,
      cancellation,
    });
    if (acquired.kind === 'refused') {
      return {kind: 'failed', failure: acquired.refusal};
    }
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
    const stopStages = connection.onNotice(notice => {
      if (notice.type === 'waitingForOtherWindow') {
        dependencies.onPhase({kind: 'waitingForOtherWindow'});
      } else if (
        notice.type === 'loginOwned' ||
        notice.type === 'loginStarted'
      ) {
        dependencies.onPhase({kind: 'initializing'});
      }
    });
    let outcome: Awaited<ReturnType<SharedConnection['connect']>>;
    try {
      outcome = await connection.connect(cancellation);
    } finally {
      login.dispose();
      stopStages();
    }
    if (outcome.kind === 'failed') {
      end();
      return {kind: 'failed', failure: ofConnection(outcome.failure)};
    }
    dependencies.adoptRunFacts(outcome.runFacts);
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
        waits: dependencies.waits(),
        socksPort: outcome.socksPort,
        storedRecord: outcome.sharedRecord ?? undefined,
        storeSharedRecord: record => connection.storeSharedRecord(record),
        onNotice: listener => connection.onNotice(listener),
        answer: (promptId, text) => connection.answer(promptId, text),
        refuse: promptId => connection.refuse(promptId),
        release: end,
      },
    };
  };
}
