/**
 * @fileoverview The entry of WSL in the desktop editor: it builds the activation's ports from the editor and this
 * machine, and on a Windows desktop the machine's WSL presence check.
 */

import {release} from 'node:os';
import * as vscode from 'vscode';
import {type CommandManifest, identifierHost} from 'lib-identifiers';
import {createLogger} from 'lib-log';
import {standDownHost} from 'lib-standdown';
import {
  createDistroInventory,
  createWslRunner,
  windowsBuildFromRelease,
} from 'lib-wsl';
import {activateWsl} from './activation.ts';
import {RUNTIME_COMMAND_IDS} from './commands/runtime-commands.ts';
import {pendingHandler, pendingHandlers} from './commands/pending-handlers.ts';
import {presenceBoundMilliseconds} from './defaults.ts';
import {commands, contextKeys, standDown} from './identifiers.generated.ts';
import {
  localFiles,
  localSession,
  localSpawner,
} from './process/local-process.ts';
import {STAND_DOWN_BUTTON, STAND_DOWN_WARNING} from './strings.ts';

/** Called by the editor when the extension activates. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const onWindows = process.platform === 'win32';
  function available(): boolean {
    return onWindows;
  }
  const inventory = onWindows
    ? createDistroInventory({
        runner: createWslRunner({
          spawner: localSpawner,
          files: localFiles,
          session: localSession(process.env),
        }),
        windowsBuild: windowsBuildFromRelease(release()),
      })
    : undefined;
  const host = identifierHost(
    vscode,
    context.extension.packageJSON as CommandManifest,
  );
  const result = await activateWsl({
    table: {
      commands,
      runtimeCommandIds: RUNTIME_COMMAND_IDS,
      standDown,
      noDistrosKey: contextKeys.noWSLDistrosInstalled,
    },
    standDownTexts: {
      warning: vscode.l10n.t(STAND_DOWN_WARNING),
      button: vscode.l10n.t(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(vscode),
    commands: host,
    contextKeys: host,
    handlers: pendingHandlers(available),
    runtimeHandler: () => pendingHandler(() => true),
    logger: createLogger(undefined, {minimumLevel: () => 'info'}),
    ...(inventory === undefined
      ? {}
      : {presence: cancellation => inventory.presence(cancellation)}),
    presenceBoundMilliseconds,
    startTimer: (milliseconds, callback) => {
      const timer = setTimeout(callback, milliseconds);
      return () => {
        clearTimeout(timer);
      };
    },
  });
  if (result.kind === 'serving') {
    context.subscriptions.push({dispose: result.dispose});
  }
}
