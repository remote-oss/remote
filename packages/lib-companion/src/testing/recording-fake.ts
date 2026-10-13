/**
 * @fileoverview A command bus for tests that plays any side of the companion interface: it records every call, can be
 * told how an id answers (an answer, a rejection, silence, a foreign or a newer-major payload), and serves the commands
 * a test registers. It is for tests only and is never imported by a bundle.
 */

import {INTERFACE_VERSION} from '../payloads.ts';
import type {CommandBus, Registration} from '../protocol.ts';

/** What the fake kept of one call. */
export interface RecordedCall {
  commandId: string;
  /** The argument's `interfaceVersion` value as received (not copied), or undefined when the argument isn't a plain object. */
  interfaceVersion: unknown;
  /** Present only when the argument is a plain object with an own `outcome` property: that property's value. */
  outcome?: unknown;
}

/** How an id answers. */
export type FakeAnswer =
  | {kind: 'answer'; result: unknown}
  | {kind: 'reject'; reason: unknown}
  | {kind: 'silent'}
  | {kind: 'foreign'}
  | {kind: 'newerMajor'};

/** A callback registered for a command id. */
type Callback = (...commandArguments: unknown[]) => unknown;

/** The fake bus. */
export interface RecordingFake extends CommandBus {
  /** Every executeCommand call, in order. */
  readonly calls: readonly RecordedCall[];
  /** Sets how an id answers from now on; a later call for the same id replaces it. */
  answerWith(commandId: string, answer: FakeAnswer): void;
  /** The callback currently registered for an id through registerCommand, or undefined. */
  registered(commandId: string): Callback | undefined;
}

/** Whether the argument is a plain object. */
function isPlainObject(argument: unknown): argument is Record<string, unknown> {
  return (
    typeof argument === 'object' &&
    argument !== null &&
    !Array.isArray(argument)
  );
}

/** What the fake records of an argument. */
function recordOf(commandId: string, argument: unknown): RecordedCall {
  if (!isPlainObject(argument)) {
    return {commandId, interfaceVersion: undefined};
  }
  return {
    commandId,
    interfaceVersion: argument.interfaceVersion,
    ...(Object.hasOwn(argument, 'outcome') && {outcome: argument.outcome}),
  };
}

/** The promise a fake answer gives. */
function promiseOf(answer: FakeAnswer): Promise<unknown> {
  switch (answer.kind) {
    case 'answer':
      return Promise.resolve(answer.result);
    case 'reject':
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the reason is whatever the test gave
      return Promise.reject(answer.reason);
    case 'silent':
      return new Promise<unknown>(() => undefined);
    case 'foreign':
      return Promise.resolve({});
    default:
      return Promise.resolve({
        interfaceVersion: {major: INTERFACE_VERSION.major + 1, minor: 0},
      });
  }
}

/** The promise of a registered callback: its return value, or its synchronous throw as a rejection. */
function promiseOfCallback(
  callback: Callback,
  argument: unknown,
): Promise<unknown> {
  try {
    return Promise.resolve(callback(argument));
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the callback threw what the test chose
    return Promise.reject(error);
  }
}

/** A fresh fake bus. */
export function createRecordingFake(): RecordingFake {
  const calls: RecordedCall[] = [];
  const answers = new Map<string, FakeAnswer>();
  const callbacks = new Map<string, Callback>();

  function executeCommand(
    commandId: string,
    argument: unknown,
  ): Promise<unknown> {
    calls.push(recordOf(commandId, argument));
    const answer = answers.get(commandId);
    if (answer !== undefined) {
      return promiseOf(answer);
    }
    const callback = callbacks.get(commandId);
    if (callback !== undefined) {
      return promiseOfCallback(callback, argument);
    }
    return Promise.reject(new Error(`command '${commandId}' not found`));
  }

  function registerCommand(
    commandId: string,
    callback: Callback,
  ): Registration {
    callbacks.set(commandId, callback);
    return {
      dispose: () => {
        if (callbacks.get(commandId) === callback) {
          callbacks.delete(commandId);
        }
      },
    };
  }

  return {
    calls,
    executeCommand,
    registerCommand,
    answerWith: (commandId, answer) => {
      answers.set(commandId, answer);
    },
    registered: commandId => callbacks.get(commandId),
  };
}
