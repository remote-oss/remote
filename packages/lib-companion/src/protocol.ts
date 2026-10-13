/**
 * @fileoverview The call protocol of the companion interface: how a caller asks another extension and how a served
 * command answers. A call never throws and gives one cause for every failure, a served command never lets a foreign
 * argument or an unknown major version reach its handler, and a fire-and-forget push swallows every rejection. It runs
 * over a command bus and a clock that the extension passes in.
 */

import {
  INTERFACE_VERSION,
  type ReadOutcome,
  type Versioned,
} from './payloads.ts';

/** Something registered that can be undone. */
export interface Registration {
  dispose(): unknown;
}

/** The editor's command operations that the protocol needs. */
export interface CommandBus {
  executeCommand(commandId: string, argument: unknown): PromiseLike<unknown>;
  registerCommand(
    commandId: string,
    callback: (...commandArguments: unknown[]) => unknown,
  ): Registration;
}

/** Runs a callback once after a delay, and cancels it. */
export interface Timers {
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
}

/** How long a call waits for its answer. */
export const CALL_LIMIT_MILLISECONDS = 10_000;

/** Why a call gave no answer. */
export type UnavailableCause =
  'notRegistered' | 'rejected' | 'timeout' | 'foreignPayload' | 'unknownMajor';

/** The outcome of a call: the answer read, or the one cause it failed for. */
export type CallOutcome<Value> =
  | {status: 'answered'; value: Value}
  | {status: 'unavailable'; cause: UnavailableCause};

/** What the version-mismatch hook is told: the command, and the major version it received and speaks. */
export interface VersionMismatch {
  commandId: string;
  receivedMajor: number;
  ownMajor: number;
}

/** A command this extension serves. */
export type Endpoint<Request> =
  | {
      commandId: string;
      kind: 'query';
      read: (payload: unknown) => ReadOutcome<Request>;
      handle: (request: Request) => unknown;
      /** The result a refused argument gets. */
      empty: () => Versioned;
    }
  | {
      commandId: string;
      kind: 'change' | 'push';
      read: (payload: unknown) => ReadOutcome<Request>;
      handle: (request: Request) => unknown;
    };

/** What a protocol is made from. */
export interface ProtocolOptions {
  bus: CommandBus;
  timers: Timers;
  /** Called at most once in the protocol's life, at the first unknown major version it meets. */
  onVersionMismatch?: (mismatch: VersionMismatch) => void;
}

/** The three operations of the protocol. */
export interface Protocol {
  call<Value>(
    commandId: string,
    argument: Versioned,
    read: (payload: unknown) => ReadOutcome<Value>,
  ): Promise<CallOutcome<Value>>;
  serve<Request>(endpoint: Endpoint<Request>): Registration;
  fireAndForget(commandId: string, argument: Versioned): void;
}

/** The major version of a payload whose reading was refused for an unknown major version. */
function majorOf(payload: unknown): number {
  return (payload as Versioned).interfaceVersion.major;
}

/** Whether the editor says the command is not registered, in the words of its own error. */
function isNotRegistered(reason: unknown, commandId: string): boolean {
  return (
    reason instanceof Error &&
    reason.message === `command '${commandId}' not found`
  );
}

/** A protocol over a command bus and a clock; the extension makes one at activation. */
export function createProtocol(options: ProtocolOptions): Protocol {
  const commands = options.bus;
  const clock = options.timers;
  let mismatchReported = false;

  function noteUnknownMajor(commandId: string, payload: unknown): void {
    if (mismatchReported) {
      return;
    }
    mismatchReported = true;
    options.onVersionMismatch?.({
      commandId,
      receivedMajor: majorOf(payload),
      ownMajor: INTERFACE_VERSION.major,
    });
  }

  function call<Value>(
    commandId: string,
    argument: Versioned,
    read: (payload: unknown) => ReadOutcome<Value>,
  ): Promise<CallOutcome<Value>> {
    return new Promise(resolve => {
      let settled = false;
      function settle(outcome: CallOutcome<Value>): void {
        settled = true;
        clock.clearTimer(handle);
        resolve(outcome);
      }
      function fail(cause: UnavailableCause): void {
        settle({status: 'unavailable', cause});
      }
      function answered(payload: unknown): void {
        if (settled) {
          return;
        }
        const outcome = read(payload);
        if (outcome.status === 'valid') {
          settle({status: 'answered', value: outcome.value});
        } else if (outcome.reason === 'unknownMajor') {
          noteUnknownMajor(commandId, payload);
          fail('unknownMajor');
        } else {
          fail('foreignPayload');
        }
      }
      function rejected(reason: unknown): void {
        if (!settled) {
          fail(
            isNotRegistered(reason, commandId) ? 'notRegistered' : 'rejected',
          );
        }
      }
      const handle = clock.setTimer(() => {
        fail('timeout');
      }, CALL_LIMIT_MILLISECONDS);
      try {
        commands.executeCommand(commandId, argument).then(answered, rejected);
      } catch {
        fail('rejected');
      }
    });
  }

  function serve<Request>(endpoint: Endpoint<Request>): Registration {
    return commands.registerCommand(
      endpoint.commandId,
      (...commandArguments) => {
        const outcome = endpoint.read(commandArguments[0]);
        if (outcome.status === 'valid') {
          return endpoint.handle(outcome.value);
        }
        if (outcome.reason === 'unknownMajor') {
          noteUnknownMajor(endpoint.commandId, commandArguments[0]);
        }
        return endpoint.kind === 'query' ? endpoint.empty() : undefined;
      },
    );
  }

  function fireAndForget(commandId: string, argument: Versioned): void {
    try {
      commands
        .executeCommand(commandId, argument)
        .then(undefined, () => undefined);
    } catch {
      // A push that cannot be sent is dropped.
    }
  }

  return {call, serve, fireAndForget};
}
