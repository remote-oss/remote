/**
 * @fileoverview The editor behind the proposed-API setup: the one module of the setup that touches `vscode`. It is
 * only imported for its types, so it loads without the editor, and each member is read when the setup asks.
 */

import type * as vscode from 'vscode';
import {windowClaimOf} from './claim.ts';
import {probeApiOf} from './vscode-api.ts';
import type {GateEditor, InstalledExtension} from './setup-ports.ts';

/** What the editor's extension object gives of an installed extension. */
interface DeclaringExtension {
  id: string;
  packageJSON?: {enabledApiProposals?: string[]};
}

/** The proposals an installed extension declares in its manifest. */
function installedOf(extension: DeclaringExtension): InstalledExtension {
  return {
    id: extension.id,
    proposals: extension.packageJSON?.enabledApiProposals ?? [],
  };
}

/** The setup's view of the editor. `subscriptions` is the extension's list of things released on deactivation. */
export function gateEditorOf(
  editor: typeof vscode,
  context: Pick<vscode.ExtensionContext, 'globalState' | 'subscriptions'>,
  readFile: (filePath: string) => Promise<string | undefined>,
): GateEditor {
  return {
    probeApi: probeApiOf(editor),
    installed: () => editor.extensions.all.map(installedOf),
    readFile,
    state: {
      read: key => context.globalState.get<boolean>(key),
      update: (key, value) => context.globalState.update(key, value),
    },
    documents: {
      onSaved: listener =>
        editor.workspace.onDidSaveTextDocument(document => {
          listener(document.uri.fsPath);
        }),
      onClosed: listener =>
        editor.workspace.onDidCloseTextDocument(document => {
          listener(document.uri.fsPath);
        }),
    },
    window: windowClaimOf(
      {
        registerCommand: (command, handler) =>
          editor.commands.registerCommand(command, handler),
        executeCommand: command => editor.commands.executeCommand(command),
      },
      context.subscriptions,
    ),
    showWarning: (text, buttons) =>
      editor.window.showWarningMessage(text, ...buttons),
    showInformation: (text, buttons) =>
      editor.window.showInformationMessage(text, ...buttons),
    runCommand: command => editor.commands.executeCommand(command),
  };
}
