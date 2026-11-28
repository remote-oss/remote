/**
 * @fileoverview The registry of the extension's commands: every command of the manifest and every runtime command has
 * its handler here. A command whose behaviour belongs to a later part has the shared one, which only opens the
 * Output channel, and leaves this table when its own handler is registered.
 */

import type {CommandHandler} from 'lib-identifiers';
import {type commands, runtimeCommands} from './identifiers.generated.ts';

/** Every runtime command id the activation registers: the ones other software raises to activate the extension. */
export const RUNTIME_COMMAND_IDS: readonly string[] = [
  runtimeCommands.isConnectedToRemote,
  runtimeCommands.connectNewWindowToTunnel,
  runtimeCommands.isAuthenticated,
  runtimeCommands.getTunnelsList,
  runtimeCommands.getActiveRemote,
  runtimeCommands.getFoldersHistory,
  runtimeCommands.connectToRemote,
  runtimeCommands.deleteFolderFromHistory,
  runtimeCommands.unregisterTunnel,
];

/** The handler that opens the Output channel at the first command or request, and does nothing else. */
export function channelHandler(openChannel: () => void): CommandHandler {
  return {
    isAvailable: () => true,
    execute: () => {
      openChannel();
    },
  };
}

/** The handlers of the manifest's commands: the shared one for each, until a later part gives one its own. */
export function commandHandlers(
  openChannel: () => void,
): Record<keyof typeof commands, CommandHandler> {
  const shared = channelHandler(openChannel);
  return {
    connectCurrentWindowToTunnel: shared,
    getStarted: shared,
    reportIssue: shared,
    settings: shared,
    showUsageLimits: shared,
    signIntoTunnelWithDifferentAccount: shared,
  };
}
