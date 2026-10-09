/**
 * @fileoverview The connector of the SSH resolver: the connect pipeline behind the interface the resolver host
 * calls. It runs one connect at a time, tells the host the phases and the loss of the transport, and ends the
 * connect and the connection when the window is torn down.
 */

import type {
  ConnectInput as ResolverInput,
  ConnectPhase,
  Connector,
} from 'lib-authority';
import type {Connected, Failed} from 'lib-authority';
import type {ConnectionNotice} from 'lib-ssh';
import type {
  Connection,
  ConnectOptions,
  PhaseEvent,
} from '../pipeline/connect.ts';
import type {ConnectInput} from '../pipeline/steps.ts';
import {failedWith} from '../pipeline/failure.ts';

/** What the connector is made from. */
export interface SshConnectorDependencies {
  /**
   * Runs one connect of the pipeline. The extension passes a function that makes the steps of a connect for the
   * input, because the plan decides what they need, and calls `connect` with them.
   */
  runPipeline: (
    input: ConnectInput,
    options: ConnectOptions,
  ) => Promise<Connection | Failed>;
  /** What every connect is given besides its steps and its cancellation. */
  optionsFor: () => Pick<
    ConnectOptions,
    'maximumReconnectionAttempts' | 'limits' | 'logger'
  >;
  /** Shows the log the connect writes, as the link of the progress does. */
  revealLog: () => void;
}

/** The connector, with the way the notices of the connection reach it. */
export interface SshConnector extends Connector {
  /** Takes in a notice of the connection lease; the transport notices end up at the host's listeners. */
  hear(notice: ConnectionNotice): void;
}

/** The phase the window shows for an event of the pipeline. */
function phaseOf(event: PhaseEvent): ConnectPhase {
  return event.kind === 'serverDownloadPercent'
    ? {name: event.kind, percent: event.percent}
    : {name: event.kind};
}

/** Whether the target is one of the two forms of an SSH host, as opposed to another family's. */
function isSshInput(input: ResolverInput): input is ResolverInput & {
  target: ConnectInput['target'];
} {
  return 'kind' in input.target;
}

/** A connector over the pipeline. */
export function createSshConnector(
  dependencies: SshConnectorDependencies,
): SshConnector {
  const phaseListeners = new Set<(phase: ConnectPhase) => void>();
  const lostListeners = new Set<() => void>();
  const closedListeners = new Set<() => void>();
  const state: {
    controller: AbortController | undefined;
    connection: Connection | undefined;
  } = {controller: undefined, connection: undefined};

  function subscribe<Listener>(
    listeners: Set<Listener>,
    listener: Listener,
  ): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function fanOut(listeners: ReadonlySet<() => void>): void {
    for (const listener of listeners) {
      listener();
    }
  }

  async function connectOnce(
    input: ResolverInput,
  ): Promise<Connected | Failed> {
    if (!isSshInput(input)) {
      return failedWith(
        {kind: 'unknown', reason: {text: 'not an SSH target'}},
        {
          attempt: input.attempt,
          isReconnection: input.isReconnection,
          maximumReconnectionAttempts:
            dependencies.optionsFor().maximumReconnectionAttempts,
          userAlreadyNotified: false,
          hints: [],
          diagnostics: [],
        },
      );
    }
    state.connection?.release();
    state.connection = undefined;
    const controller = new AbortController();
    state.controller = controller;
    const pipelineInput: ConnectInput = {
      target: input.target,
      rawHostString: input.rawHostString,
      attempt: input.attempt,
      isReconnection: input.isReconnection,
      windowId: input.windowId,
      windowWorkspace: input.windowWorkspace,
    };
    const outcome = await dependencies.runPipeline(pipelineInput, {
      ...dependencies.optionsFor(),
      cancellation: controller.signal,
      onPhase: event => {
        const phase = phaseOf(event);
        for (const listener of phaseListeners) {
          listener(phase);
        }
      },
    });
    if ('connected' in outcome) {
      state.connection = outcome;
      return outcome.connected;
    }
    return outcome;
  }

  return {
    connect: connectOnce,
    cancel: () => {
      state.controller?.abort();
      state.connection?.release();
      state.connection = undefined;
    },
    revealDetails: dependencies.revealLog,
    onPhase: listener => subscribe(phaseListeners, listener),
    onTransportLost: listener => subscribe(lostListeners, listener),
    onTransportClosed: listener => subscribe(closedListeners, listener),
    hear: notice => {
      if (notice.type === 'transportLost') {
        fanOut(lostListeners);
      } else if (notice.type === 'helperGone') {
        fanOut(closedListeners);
      }
    },
  };
}
