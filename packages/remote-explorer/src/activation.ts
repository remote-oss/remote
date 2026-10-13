/**
 * @fileoverview The activation of Remote Explorer: the stand-down guard first, then the proposed-API setup, and only
 * when both let it serve, the commands the package registers. Nothing is registered before the guard and the setup
 * have decided, and nothing at all when the package stands down.
 */

import {
  type CommandEntry,
  type CommandHandler,
  type CommandHost,
  registerCommands,
} from 'lib-identifiers';
import {standDownIfPresent, type StandDownHost} from 'lib-standdown';

/** The part of the package's identifier table that activation uses. */
interface ExplorerTable<
  Commands extends Readonly<Record<string, CommandEntry>>,
> {
  readonly commands: Commands;
  readonly standDown: {
    readonly standsDownFor: string;
    readonly contextKey: string;
  };
}

/** Everything activation needs from its surroundings. */
export interface ExplorerActivationInputs<
  Commands extends Readonly<Record<string, CommandEntry>>,
> {
  table: ExplorerTable<Commands>;
  /** The coexistence warning and its button, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  handlers: {readonly [Name in keyof Commands]: CommandHandler};
  /** Runs the proposed-API setup; the activation waits for it before registering. */
  setup: () => PromiseLike<unknown>;
}

/** How activation ended: the package stands down, or it serves with the end of what it registered. */
export type ExplorerActivation =
  {kind: 'standing'} | {kind: 'serving'; dispose: () => void};

/**
 * Runs the activation. On `standing` the setup has not run and nothing is registered. A setup that fails fails the
 * activation, with nothing registered.
 */
export async function activateExplorer<
  Commands extends Readonly<Record<string, CommandEntry>>,
>(inputs: ExplorerActivationInputs<Commands>): Promise<ExplorerActivation> {
  const {table} = inputs;
  const {standsDownFor, contextKey: standingDownKey} = table.standDown;
  const {warning, button} = inputs.standDownTexts;
  const outcome = await standDownIfPresent(inputs.standDown, {
    standsDownFor,
    standingDownKey,
    warning,
    button,
  });
  if (outcome === 'standing') {
    return {kind: 'standing'};
  }
  await inputs.setup();
  const registration = registerCommands(
    inputs.commands,
    outcome,
    table.commands,
    inputs.handlers,
  );
  return {
    kind: 'serving',
    dispose: () => {
      registration.dispose();
    },
  };
}

/** A handler per command that does nothing and returns nothing, whatever the argument. */
export function silentHandlers<
  Commands extends Readonly<Record<string, CommandEntry>>,
>(commands: Commands): {readonly [Name in keyof Commands]: CommandHandler} {
  return Object.fromEntries(
    Object.keys(commands).map(name => [name, {execute: () => undefined}]),
  ) as {readonly [Name in keyof Commands]: CommandHandler};
}
