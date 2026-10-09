/**
 * @fileoverview The activation of Remote - SSH: the stand-down guard first, and only when it says to serve, the log
 * channel and the commands this package serves. Nothing is registered before the guard has decided, and nothing at
 * all when it stands down.
 */

import {
  type CommandEntry,
  type CommandHost,
  registerCommands,
  readSetting,
  type SettingEntry,
  type SettingHost,
} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {standDownIfPresent, type StandDownHost} from 'lib-standdown';
import {
  helpHandlers,
  type HelpEditor,
  type HelpExtension,
  type HelpLinks,
} from './help-commands.ts';
import {
  type ChannelPort,
  levelOfSetting,
  type LogEnvironment,
  openLogChannel,
} from './log-channel.ts';

/** The part of the package's identifier table that activation uses. */
export interface ActivationTable {
  readonly commands: {
    readonly showLog: CommandEntry;
    readonly getHelp: CommandEntry;
    readonly getStarted: CommandEntry;
    readonly provideFeedback: CommandEntry;
    readonly settings: CommandEntry;
    readonly reportIssue: CommandEntry;
  };
  readonly settings: {readonly logLevel: SettingEntry};
  readonly standDown: {
    readonly standsDownFor: string;
    readonly contextKey: string;
  };
}

/** Everything activation needs from its surroundings. */
export interface ActivationInputs {
  table: ActivationTable;
  extension: HelpExtension & {name: string; version: string};
  links: HelpLinks;
  environment: Omit<LogEnvironment, 'extensionName' | 'extensionVersion'>;
  /** The warning and its button for a window where the other extension runs, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  settings: SettingHost;
  help: HelpEditor;
  channels: ChannelPort;
  clock: () => number;
}

/** How activation ended: the package stands down, or it serves with its logger and an end for what it opened. */
export type ActivationResult =
  {kind: 'standing'} | {kind: 'serving'; logger: Logger; dispose(): void};

/**
 * Runs the activation. On `standing` nothing has been opened or registered. On `serving` the log channel is open and
 * the commands are registered; `dispose` undoes both.
 */
export async function activateRemoteSsh(
  inputs: ActivationInputs,
): Promise<ActivationResult> {
  const {table, extension} = inputs;
  const outcome = await standDownIfPresent(inputs.standDown, {
    standsDownFor: table.standDown.standsDownFor,
    standingDownKey: table.standDown.contextKey,
    warning: inputs.standDownTexts.warning,
    button: inputs.standDownTexts.button,
  });
  if (outcome === 'standing') {
    return {kind: 'standing'};
  }
  const logChannel = openLogChannel(
    inputs.channels,
    {
      ...inputs.environment,
      extensionName: extension.name,
      extensionVersion: extension.version,
    },
    () => levelOfSetting(readSetting(inputs.settings, table.settings.logLevel)),
    inputs.clock,
  );
  const registration = registerCommands(
    inputs.commands,
    outcome,
    table.commands,
    {
      showLog: {
        execute: () => {
          logChannel.reveal();
        },
      },
      ...helpHandlers(inputs.help, inputs.links, extension),
    },
  );
  return {
    kind: 'serving',
    logger: logChannel.logger,
    dispose: () => {
      registration.dispose();
      logChannel.dispose();
    },
  };
}
