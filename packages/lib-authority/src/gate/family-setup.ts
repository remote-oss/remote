/**
 * @fileoverview The proposed-API setup of an extension of the family over the running editor: what every extension
 * supplies, and the one place that puts it into the setup's identity.
 */

import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import type * as vscode from 'vscode';
import type {ProposalName} from './probe.ts';
import {
  type GateNotices,
  type SetupTexts,
  setupPortsOf,
} from './setup-ports.ts';
import type {SetupPorts} from './setup.ts';
import {gateEditorOf} from './vscode-setup.ts';

/** What an extension of the family supplies to the shared setup. */
export interface FamilySetupOptions {
  displayName: string;
  proposals: readonly ProposalName[];
  /** The ids of the remote views the extension contributes. */
  viewIds: readonly string[];
  /** The extension's own English templates, which `translate` turns into the display language. */
  templates: SetupTexts;
  /** A template in the display language: the extension's `vscode.l10n.t`. */
  translate: (template: string) => string;
  /** The editor's data folder name, from its product.json; read only when the setup needs it. */
  dataFolderName: () => PromiseLike<string>;
  logFailure: (message: string) => void;
  /** The non-modal notices the setup shows; the editor's own when none is given. */
  notices?: GateNotices;
}

/** The text of a file, or nothing when it cannot be read. */
async function readArgvFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    // No runtime-arguments file yet, or one the user cannot read: the same as none.
    return undefined;
  }
}

/** The editor's own notices: an information or a warning message with buttons. */
function editorNotices(editor: typeof vscode): GateNotices {
  return {
    showInformation: (text, buttons) =>
      editor.window.showInformationMessage(text, ...buttons),
    showWarning: (text, buttons) =>
      editor.window.showWarningMessage(text, ...buttons),
  };
}

/** The setup's ports for the extension: the editor's, the extension's identity and the display language's texts. */
export function familySetupPortsOf(
  editor: typeof vscode,
  context: Pick<
    vscode.ExtensionContext,
    'globalState' | 'subscriptions' | 'extension'
  >,
  options: FamilySetupOptions,
): SetupPorts {
  return setupPortsOf(
    gateEditorOf(
      editor,
      context,
      readArgvFile,
      options.logFailure,
      options.notices ?? editorNotices(editor),
    ),
    {
      extensionId: context.extension.id,
      displayName: options.displayName,
      applicationName: editor.env.appName,
      proposals: options.proposals,
      viewIds: options.viewIds,
      argv: {
        portableFolder: process.env.VSCODE_PORTABLE,
        homeFolder: homedir(),
        dataFolderName: options.dataFolderName,
      },
      platform: process.platform,
      texts: {
        setup: options.translate(options.templates.setup),
        failedAttempt: options.translate(options.templates.failedAttempt),
        restart: options.translate(options.templates.restart),
        configureButton: options.translate(options.templates.configureButton),
        notNowButton: options.translate(options.templates.notNowButton),
        quitButton: options.translate(options.templates.quitButton),
      },
      logFailure: options.logFailure,
    },
  );
}
