/**
 * @fileoverview The entry of Remote - Tunnels in the desktop editor: it builds the activation's inputs from the editor.
 */

import * as vscode from 'vscode';
import {type CommandManifest, identifierHost} from 'lib-identifiers';
import {standDownHost} from 'lib-standdown';
import {activateTunnels} from './activation.ts';
import {commands, standDown} from './identifiers.generated.ts';
import {lazyChannel} from './output-channel.ts';
import {
  DISPLAY_NAME,
  RESOLVER_UNAVAILABLE,
  STAND_DOWN_BUTTON,
  STAND_DOWN_WARNING,
} from './strings.ts';

/** Called by the editor when the extension activates. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const openChannel = lazyChannel(
    // eslint-disable-next-line id-length -- the editor's option is named log
    () => vscode.window.createOutputChannel(DISPLAY_NAME, {log: true}),
    typeof vscode.workspace.registerRemoteAuthorityResolver === 'function',
    vscode.l10n.t(RESOLVER_UNAVAILABLE),
  );
  const result = await activateTunnels({
    table: {commands, standDown},
    standDownTexts: {
      warning: vscode.l10n.t(STAND_DOWN_WARNING),
      button: vscode.l10n.t(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(vscode),
    commands: identifierHost(
      vscode,
      context.extension.packageJSON as CommandManifest,
    ),
    openChannel: () => {
      openChannel();
    },
  });
  if (result.kind === 'serving') {
    context.subscriptions.push({dispose: result.dispose});
  }
}
