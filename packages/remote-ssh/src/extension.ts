/**
 * @fileoverview The Remote - SSH extension's entry point: it loads the editor, which exists only in the
 * extension host, so the unit tests do not load it. Activation runs the stand-down guard and, when this extension
 * serves, opens the log and registers the commands the package serves.
 */

import * as vscode from 'vscode';
import {identifierHost} from 'lib-identifiers';
import {standDownHost} from 'lib-standdown';
import {activateRemoteSsh} from './activation.ts';
import {helpLinksOf} from './help-commands.ts';
import {commands, settings, standDown} from './identifiers.generated.ts';

/** The stand-down warning and its button, as written in the runtime strings. */
const STAND_DOWN_WARNING =
  'Remote - SSH stays inactive in this window because another extension that provides SSH remotes is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';
const STAND_DOWN_BUTTON = 'Show Other Extension';

/** What the editor tells about the extension, as far as activation reads it. */
interface Manifest {
  name: string;
  version: string;
  extensionPack?: string[];
  contributes?: {
    commands?: Array<{command: string; title: string}>;
    remoteHelp?: Record<string, unknown>;
  };
}

let serving: {dispose(): void} | undefined;

/** Called by the editor when it resolves an `ssh-remote` authority, runs one of the commands, or opens a URI. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  const host = identifierHost(vscode, manifest);
  const result = await activateRemoteSsh({
    table: {commands, settings, standDown},
    extension: {
      id: context.extension.id,
      pack: manifest.extensionPack ?? [],
      name: manifest.name,
      version: manifest.version,
    },
    links: helpLinksOf(manifest),
    environment: {
      editorVersion: vscode.version,
      platform: process.platform,
      architecture: process.arch,
    },
    standDownTexts: {
      warning: vscode.l10n.t(STAND_DOWN_WARNING),
      button: vscode.l10n.t(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(vscode),
    commands: host,
    settings: host,
    help: {
      openExternal: address =>
        vscode.env.openExternal(vscode.Uri.parse(address)),
      openSettings: filter =>
        vscode.commands.executeCommand('workbench.action.openSettings', filter),
      openIssueReporter: extensionId =>
        vscode.commands.executeCommand('workbench.action.openIssueReporter', {
          extensionId,
        }),
    },
    channels: vscode.window,
    clock: Date.now,
  });
  if (result.kind === 'serving') {
    serving = result;
    context.subscriptions.push({
      dispose: () => {
        result.dispose();
      },
    });
  }
}

/** Called by the editor when the extension host ends. */
export function deactivate(): void {
  serving?.dispose();
  serving = undefined;
}
