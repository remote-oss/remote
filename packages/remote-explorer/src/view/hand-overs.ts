/**
 * @fileoverview The two commands of the "SSH" group row that hand over to Remote - SSH: open the configuration file,
 * and add a host. Each runs the companion's command with no argument, and nothing shows when it fails. Opening the
 * configuration file needs no row, so its key hands over too; adding a host runs only from the group row.
 */

import {SSH_HAND_OVERS} from 'lib-companion';
import type {CommandHandler} from 'lib-identifiers';
import type {ViewSession} from './targets.ts';

/** The editor's way to run a command. */
export interface HandOverHost {
  executeCommand(commandId: string): PromiseLike<unknown>;
}

/** A handler that runs `commandId`, whatever it is given; a rejection of the command ends here. */
function handOver(host: HandOverHost, commandId: string): CommandHandler {
  return {
    execute: async () => {
      try {
        await host.executeCommand(commandId);
      } catch {
        // The row shows nothing of a failed hand-over.
      }
      return undefined;
    },
  };
}

/**
 * A handler that runs `commandId` when it is given the "SSH" group row of a view whose companion is present, and does
 * nothing for any other argument: the command writes to the user's SSH configuration, which a key pressed with no row
 * must not do.
 */
function handOverFromRow(
  session: () => ViewSession | undefined,
  host: HandOverHost,
  commandId: string,
): CommandHandler {
  const handler = handOver(host, commandId);
  return {
    execute: argument =>
      session()?.targets.groupOf(argument) === undefined
        ? undefined
        : handler.execute(argument),
  };
}

/** The handlers of the two hand-over commands, over the view's session once it exists. */
export function handOverHandlers(
  session: () => ViewSession | undefined,
  host: HandOverHost,
): {
  readonly configureSsh: CommandHandler;
  readonly remoteExplorerAdd: CommandHandler;
} {
  return {
    configureSsh: handOver(host, SSH_HAND_OVERS.openConfigFile),
    remoteExplorerAdd: handOverFromRow(
      session,
      host,
      SSH_HAND_OVERS.addNewSshHost,
    ),
  };
}
