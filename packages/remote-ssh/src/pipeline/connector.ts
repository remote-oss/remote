/**
 * @fileoverview The connector the resolver host runs: one pipeline connect for each resolve, its stages told to the
 * window, and the connection that worked held until the window ends or connects again, with what happens to its
 * transport passed on.
 */

import type {
  ConnectInput as HostConnectInput,
  ConnectPhase,
  Connected,
  Connector,
  Failed,
} from 'lib-authority';
import {
  connect,
  type Connection,
  type ConnectOptions,
  type PhaseEvent,
} from './connect.ts';
import {failedWith} from './failure.ts';
import type {ConnectInput, ConnectSteps} from './steps.ts';

/** What the connector is made of. */
export interface ConnectorDependencies {
  /** Makes the steps of one connect, so what they share lives for that connect alone. */
  stepsFor: () => ConnectSteps;
  /** The options of one connect, except its cancellation and its phase listener, which the connector supplies. */
  options: Omit<ConnectOptions, 'cancellation' | 'onPhase'>;
  /** Reveals the connection's log: what the progress's details link shows. */
  revealLog(): void;
}

/** A set of listeners that each hear an event; one that throws does not keep it from the others. */
class Listeners<Event> {
  private readonly listeners = new Set<(event: Event) => void>();

  /** Adds `listener` and returns what removes it. */
  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tells every listener. */
  tell(event: Event): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A listener's fault is its own; the others and the connect go on.
      }
    }
  }
}

/** The stage the window is shown for a pipeline phase. */
function phaseOf(event: PhaseEvent): ConnectPhase {
  return event.kind === 'serverDownloadPercent'
    ? {name: event.kind, percent: event.percent}
    : {name: event.kind};
}

/**
 * The pipeline's input for the host's, or nothing when the target is not an ssh-remote one: the host decodes with the
 * family's codec, so an ssh-remote resolver only gets ssh targets, and the other shapes have no `kind`.
 */
function pipelineInputOf(input: HostConnectInput): ConnectInput | undefined {
  const {target} = input;
  return 'kind' in target ? {...input, target} : undefined;
}

/** The failure of a target that is not an ssh-remote one: the window names the host, with no reason of its own. */
const NOT_SSH_TARGET: Failed = {
  kind: 'unknown',
  retryable: false,
  silent: false,
  userAlreadyNotified: false,
  hints: [],
  diagnostics: [],
};

/** The connection the window holds, and the end of hearing its transport. */
interface Held {
  connection: Connection;
  stop: () => void;
}

function isConnection(result: Connection | Failed): result is Connection {
  return 'connected' in result;
}

/** The connector of Remote - SSH over its pipeline. */
export function connectorOf(dependencies: ConnectorDependencies): Connector {
  const phases = new Listeners<ConnectPhase>();
  const lost = new Listeners<undefined>();
  const closed = new Listeners<undefined>();
  let running: AbortController | undefined;
  let held: Held | undefined;

  /** Gives back the connection the window holds, and stops hearing its transport. */
  function releaseHeld(): void {
    const current = held;
    held = undefined;
    if (current !== undefined) {
      current.stop();
      current.connection.release();
    }
  }

  return {
    async connect(hostInput): Promise<Connected | Failed> {
      releaseHeld();
      const input = pipelineInputOf(hostInput);
      if (input === undefined) {
        return NOT_SSH_TARGET;
      }
      const controller = new AbortController();
      running = controller;
      try {
        const result = await connect(input, dependencies.stepsFor(), {
          ...dependencies.options,
          cancellation: controller.signal,
          onPhase: event => {
            phases.tell(phaseOf(event));
          },
        });
        if (!isConnection(result)) {
          return result;
        }
        if (controller.signal.aborted) {
          // The window was torn down while the server started or the tunnel opened: give the connection back.
          result.release();
          return failedWith(
            {kind: 'cancelled'},
            {
              attempt: input.attempt,
              isReconnection: input.isReconnection,
              maximumReconnectionAttempts:
                dependencies.options.maximumReconnectionAttempts,
              userAlreadyNotified: false,
              hints: [],
              diagnostics: [],
            },
          );
        }
        const stop = result.onTransport(event => {
          // A connection given back may still deliver an event already under way; only the held one counts.
          if (held?.connection === result) {
            (event === 'lost' ? lost : closed).tell(undefined);
          }
        });
        held = {connection: result, stop};
        return result.connected;
      } finally {
        if (running === controller) {
          running = undefined;
        }
      }
    },
    cancel() {
      running?.abort();
      running = undefined;
      releaseHeld();
    },
    revealDetails() {
      dependencies.revealLog();
    },
    onPhase: listener => phases.subscribe(listener),
    onTransportLost: listener =>
      lost.subscribe(() => {
        listener();
      }),
    onTransportClosed: listener =>
      closed.subscribe(() => {
        listener();
      }),
  };
}
