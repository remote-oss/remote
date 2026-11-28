/**
 * @fileoverview The activation of Remote - Tunnels: the stand-down guard first, then the registration of every
 * command. Nothing is registered, written or shown when the package stands down, and no Output channel exists before
 * a command or request needs it.
 */

import {
  type CommandEntry,
  type CommandHandler,
  type CommandHost,
  registerCommands,
} from 'lib-identifiers';
import {standDownIfPresent, type StandDownHost} from 'lib-standdown';
import {
  channelHandler,
  commandHandlers,
  RUNTIME_COMMAND_IDS,
} from './commands.ts';
import type {commands} from './identifiers.generated.ts';

/** The part of the package's identifier table that activation uses. */
interface TunnelTable {
  readonly commands: typeof commands;
  readonly standDown: {
    readonly standsDownFor: string;
    readonly contextKey: string;
  };
}

/** Everything activation needs from its surroundings. */
export interface TunnelActivationInputs {
  table: TunnelTable;
  /** The coexistence warning and its button, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  /** Opens the Output channel, creating it at its first call. */
  openChannel: () => void;
}

/** How activation ended: the package stands down, or it serves, with the end of what it registered. */
export type TunnelActivation =
  {kind: 'standing'} | {kind: 'serving'; dispose: () => void};

/** The entry under which a runtime command is registered: silent, and in no palette. */
function runtimeEntry(commandId: string): CommandEntry {
  return {id: commandId, title: commandId, palette: false, policy: 'silent'};
}

/** Runs the activation. On `standing` nothing is registered. */
export async function activateTunnels(
  inputs: TunnelActivationInputs,
): Promise<TunnelActivation> {
  const {table} = inputs;
  const outcome = await standDownIfPresent(inputs.standDown, {
    ...inputs.standDownTexts,
    standsDownFor: table.standDown.standsDownFor,
    standingDownKey: table.standDown.contextKey,
  });
  if (outcome !== 'serving') {
    return {kind: 'standing'};
  }
  const registration = registerCommands(
    inputs.commands,
    outcome,
    table.commands,
    commandHandlers(inputs.openChannel),
  );
  const runtimeHandler: CommandHandler = channelHandler(inputs.openChannel);
  const runtimeRegistration = registerCommands(
    inputs.commands,
    outcome,
    Object.fromEntries(
      RUNTIME_COMMAND_IDS.map(each => [each, runtimeEntry(each)]),
    ),
    Object.fromEntries(RUNTIME_COMMAND_IDS.map(each => [each, runtimeHandler])),
  );
  return {
    kind: 'serving',
    dispose: () => {
      registration.dispose();
      runtimeRegistration.dispose();
    },
  };
}
