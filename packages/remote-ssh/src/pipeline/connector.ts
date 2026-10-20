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
import {forwardingEnvironment} from '../environment/forwarding.ts';
import {
  connect,
  type Connection,
  type ConnectOptions,
  type PhaseEvent,
} from './connect.ts';
import {failedWith} from './failure.ts';
import type {SshTarget} from 'lib-ssh';
import {sshTargetOf} from './host-settings.ts';
import type {ConnectInput, ConnectSteps} from './steps.ts';

/** What the connector is made of. */
export interface ConnectorDependencies {
  /** Makes the steps of one connect, so what they share lives for that connect alone. */
  stepsFor: (onPhase: (event: PhaseEvent) => void) => ConnectSteps;
  /** Whether a connect runs in terminal mode (each window its own `ssh`); read once when the connect starts. */
  terminalMode: () => boolean;
  /** The options of one connect, except its cancellation and its phase listener, which the connector supplies. */
  options: Omit<ConnectOptions, 'cancellation' | 'onPhase'>;
  /** Reveals the connection's log: what the progress's details link shows. */
  revealLog(): void;
  /** Makes these the only variables the window's terminals get from the extension, for the connect that worked. */
  applyTerminalEnvironment(variables: Readonly<Record<string, string>>): void;
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

/**
 * The stage the window is shown for a pipeline phase. The details link goes with `initializing` and, in terminal
 * mode, with `settingUpTunnel`, whatever the order of the stages; no other stage carries it.
 */
function phaseOf(
  event: Exclude<PhaseEvent, {kind: 'promptShown'}>,
  terminalMode: boolean,
): ConnectPhase {
  if (event.kind === 'serverDownloadPercent') {
    return {name: event.kind, percent: event.percent};
  }
  const details =
    event.kind === 'initializing' ||
    (event.kind === 'settingUpTunnel' && terminalMode);
  const quiet =
    (event.kind === 'initializing' && event.quiet === true) ||
    event.kind === 'settingUpTunnel';
  return {
    name: event.kind,
    ...(details ? {details: true as const} : {}),
    ...(quiet ? {quiet: true as const} : {}),
  };
}

/** The stage again, as a prompt is about to be shown: the same text, and not quiet. */
function promptedStage(stage: ConnectPhase): ConnectPhase {
  return {
    name: stage.name,
    ...(stage.percent === undefined ? {} : {percent: stage.percent}),
    ...(stage.details === true ? {details: true as const} : {}),
  };
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

/** The connection the window holds, the end of hearing its transport, and whether its transport was lost. */
interface Held {
  connection: Connection;
  target: SshTarget;
  terminalMode: boolean;
  stop: () => void;
  lost: boolean;
}

/** The connector of Remote - SSH, with what the window's commands read of its connection. */
export interface SshConnector extends Connector {
  /**
   * The TCP port of the server of the connection the window holds; `none` while it holds none or its transport was
   * lost, since a reconnection's server may listen elsewhere. It never throws.
   */
  serverPort(): number | 'none';
  /**
   * The host of the connection the window holds and whether it was made in terminal mode; nothing while the window
   * holds none or its transport was lost.
   */
  heldHost(): {target: SshTarget; terminalMode: boolean} | undefined;
}

function isConnection(result: Connection | Failed): result is Connection {
  return 'connected' in result;
}

/** The line a step of the connect's notification gives the log, or its percent for the server download. */
function progressLine(
  event: Exclude<PhaseEvent, {kind: 'promptShown'}>,
): string {
  return event.kind === 'serverDownloadPercent'
    ? `Downloading VS Code Server: ${String(event.percent)}%`
    : `Progress: ${event.kind}`;
}

/** The connector of Remote - SSH over its pipeline. */
export function connectorOf(dependencies: ConnectorDependencies): SshConnector {
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
        const terminalMode = dependencies.terminalMode();
        let told: ConnectPhase = {name: 'initializing', details: true};
        function onPhase(event: PhaseEvent): void {
          if (event.kind === 'promptShown') {
            phases.tell(promptedStage(told));
            return;
          }
          if (event.kind !== 'initializing' || event.quiet !== true) {
            // A quiet step shows no notification, so the log, which follows the notification, skips it too.
            dependencies.options.logger.info(progressLine(event));
          }
          told = phaseOf(event, terminalMode);
          phases.tell(told);
        }
        const result = await connect(input, dependencies.stepsFor(onPhase), {
          ...dependencies.options,
          cancellation: controller.signal,
          onPhase,
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
            if (event === 'lost') {
              held.lost = true;
            }
            (event === 'lost' ? lost : closed).tell(undefined);
          }
        });
        held = {
          connection: result,
          target: sshTargetOf(input.target),
          terminalMode,
          stop,
          lost: false,
        };
        dependencies.applyTerminalEnvironment(
          forwardingEnvironment(result.forwarding),
        );
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
    serverPort() {
      return held === undefined || held.lost
        ? 'none'
        : held.connection.serverPort;
    },
    heldHost() {
      return held === undefined || held.lost
        ? undefined
        : {target: held.target, terminalMode: held.terminalMode};
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
