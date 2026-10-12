/**
 * @fileoverview The Remote - SSH extension's entry point: it loads the editor, which exists only in the
 * extension host, so the unit tests do not load it. Activation runs the stand-down guard and, when this extension
 * serves, opens the log and registers the commands the package serves.
 */

import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {gateEditorOf, type ProposalName, setupPortsOf} from 'lib-authority';
import {identifierHost} from 'lib-identifiers';
import {readProfile} from 'lib-product';
import {standDownHost} from 'lib-standdown';
import {activateRemoteSsh} from './activation.ts';
import {helpLinksOf} from './help-commands.ts';
import {commands, settings, standDown} from './identifiers.generated.ts';

/** The stand-down warning and its button, as written in the runtime strings. */
const STAND_DOWN_WARNING =
  'Remote - SSH stays inactive in this window because another extension that provides SSH remotes is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';
const STAND_DOWN_BUTTON = 'Show Other Extension';

/**
 * The texts of the proposed-API setup notices. `{0}` is the extension's name, `{1}` the
 * editor's, `{2}` the ids to add or the extension's own id.
 */
const SETUP_TEXTS = {
  setup:
    "{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.",
  failedAttempt:
    "The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists '{2}', then restart {1}.",
  restart: 'Quit and start {1} again to apply the changes to argv.json.',
  configureButton: 'Configure Runtime Arguments',
  notNowButton: 'Not Now',
  quitButton: 'Quit {1}',
};

/** What the editor tells about the extension, as far as activation reads it. */
interface Manifest {
  name: string;
  displayName: string;
  version: string;
  extensionPack?: string[];
  enabledApiProposals?: ProposalName[];
  contributes?: {
    commands?: Array<{command: string; title: string}>;
    remoteHelp?: Record<string, unknown>;
  };
}

/** The `dataFolderName` of the editor's product, which names the folder of its runtime arguments. */
async function dataFolderNameOfEditor(): Promise<string> {
  const reading = readProfile(
    await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'),
  );
  if (reading.kind === 'unreadable') {
    throw new Error(`product.json cannot be read: ${reading.reason}`);
  }
  return reading.profile.dataFolderName;
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

/** Called by the editor when it resolves an `ssh-remote` authority, runs one of the commands, or opens a URI. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  const host = identifierHost(vscode, manifest);
  const dataFolderName = await dataFolderNameOfEditor();
  const result = await activateRemoteSsh({
    table: {commands, settings, standDown},
    extension: {
      id: context.extension.id,
      pack: manifest.extensionPack ?? [],
      name: manifest.name,
      version: manifest.version,
    },
    links: () => helpLinksOf(manifest),
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
    gate: logFailure =>
      setupPortsOf(gateEditorOf(vscode, context, readArgvFile), {
        extensionId: context.extension.id,
        displayName: manifest.displayName,
        applicationName: vscode.env.appName,
        proposals: manifest.enabledApiProposals ?? [],
        argv: {
          portableFolder: process.env.VSCODE_PORTABLE,
          homeFolder: homedir(),
          dataFolderName,
        },
        texts: SETUP_TEXTS,
        logFailure,
      }),
  });
  if (result.kind === 'serving') {
    context.subscriptions.push({
      dispose: () => {
        result.dispose();
      },
    });
  }
}
