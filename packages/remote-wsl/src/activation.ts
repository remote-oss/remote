/**
 * @fileoverview The activation of WSL in a desktop or browser window: the stand-down guard first, then the
 * registration of every command, then, on a Windows desktop only, the machine's WSL presence, read without waiting
 * for it. Nothing is registered and nothing is read when the package stands down.
 */

import {
  type CommandEntry,
  type CommandHandler,
  type CommandHost,
  type ContextKeyEntry,
  type ContextKeyHost,
  registerCommands,
  setContextKey,
} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {standDownIfPresent, type StandDownHost} from 'lib-standdown';

/** What the machine's WSL presence check found, as far as the activation reads it. */
export interface PresenceResult {
  readonly kind: 'absent' | 'noDistro' | 'present';
}

/** The part of the package's identifier table that activation uses. */
interface WslTable<Commands extends Readonly<Record<string, CommandEntry>>> {
  readonly commands: Commands;
  readonly runtimeCommandIds: readonly string[];
  readonly standDown: {
    readonly standsDownFor: string;
    readonly contextKey: string;
  };
  readonly noDistrosKey: ContextKeyEntry;
}

/** Everything activation needs from its surroundings. */
export interface WslActivationInputs<
  Commands extends Readonly<Record<string, CommandEntry>>,
> {
  table: WslTable<Commands>;
  /** The coexistence warning and its button, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  contextKeys: ContextKeyHost;
  handlers: {readonly [Name in keyof Commands]: CommandHandler};
  /** The handler of each runtime command, which no menu or palette shows, by its id. */
  runtimeHandler: (commandId: string) => CommandHandler;
  logger: Logger;
  /** The machine's WSL presence check, on a Windows desktop only. */
  presence?: (cancellation: AbortSignal) => PromiseLike<PresenceResult>;
  presenceBoundMilliseconds: number;
  /** Calls `callback` once after `milliseconds`; the function it returns stops it. */
  startTimer(milliseconds: number, callback: () => void): () => void;
}

/**
 * How activation ended: the package stands down, or it serves, with the end of what it registered and a promise
 * that settles once the presence check has set its key, failed or run out of time.
 */
export type WslActivation =
  | {kind: 'standing'}
  | {kind: 'serving'; presenceSettled: Promise<void>; dispose: () => void};

/** The entry under which a runtime command is registered: silent, and in no palette. */
function runtimeEntry(commandId: string): CommandEntry {
  return {id: commandId, title: commandId, palette: false, policy: 'silent'};
}

/**
 * Reads the machine's WSL presence and sets the distro key from it: true when WSL has no distro, false otherwise. A
 * check that fails or outlasts its bound sets nothing; one that runs out of time writes one log line.
 */
function readPresence<Commands extends Readonly<Record<string, CommandEntry>>>(
  inputs: WslActivationInputs<Commands>,
  presence: (cancellation: AbortSignal) => PromiseLike<PresenceResult>,
): Promise<void> {
  const controller = new AbortController();
  return new Promise<void>(settle => {
    const stopTimer = inputs.startTimer(
      inputs.presenceBoundMilliseconds,
      () => {
        controller.abort();
        inputs.logger.info(
          `the WSL presence check gave no answer within ${String(inputs.presenceBoundMilliseconds)} ms`,
        );
        settle();
      },
    );
    presence(controller.signal).then(
      result => {
        if (controller.signal.aborted) {
          return;
        }
        stopTimer();
        void setContextKey(
          inputs.contextKeys,
          inputs.table.noDistrosKey,
          result.kind === 'noDistro',
        );
        settle();
      },
      () => {
        stopTimer();
        settle();
      },
    );
  });
}

/** Runs the activation. On `standing` nothing is registered and the presence is not read. */
export async function activateWsl<
  Commands extends Readonly<Record<string, CommandEntry>>,
>(inputs: WslActivationInputs<Commands>): Promise<WslActivation> {
  const {table} = inputs;
  const request = {
    standsDownFor: table.standDown.standsDownFor,
    standingDownKey: table.standDown.contextKey,
    warning: inputs.standDownTexts.warning,
    button: inputs.standDownTexts.button,
  };
  const outcome = await standDownIfPresent(inputs.standDown, request);
  if (outcome !== 'serving') {
    return {kind: 'standing'};
  }
  const registration = registerCommands(
    inputs.commands,
    outcome,
    table.commands,
    inputs.handlers,
  );
  const runtimeIds = table.runtimeCommandIds;
  const runtimeRegistration = registerCommands(
    inputs.commands,
    outcome,
    Object.fromEntries(runtimeIds.map(each => [each, runtimeEntry(each)])),
    Object.fromEntries(
      runtimeIds.map(each => [each, inputs.runtimeHandler(each)]),
    ),
  );
  const presenceSettled =
    inputs.presence === undefined
      ? Promise.resolve()
      : readPresence(inputs, inputs.presence);
  return {
    kind: 'serving',
    presenceSettled,
    dispose: () => {
      registration.dispose();
      runtimeRegistration.dispose();
    },
  };
}
