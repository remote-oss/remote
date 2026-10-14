/**
 * @fileoverview The entry of Dev Containers in the desktop editor: it hands the editor to the activation, with the
 * proposed-API setup and the strings of the notices.
 */

import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import {familySetupPortsOf} from 'lib-authority';
import {identifierHost} from 'lib-identifiers';
import {profileOf} from 'lib-product';
import {standDownHost} from 'lib-standdown';
import {activateContainers} from './activation.ts';
import {serializedUriOf} from './authority/payload.ts';
import {cliBridgeOf} from './cli/cli-bridge.ts';
import {cliPathsOf} from './cli/cli-paths.ts';
import {nodeCliHost} from './cli/node-cli-host.ts';
import {systemCliPorts} from './cli/node-cli-ports.ts';
import {overrideStoreOf} from './cli/override-files.ts';
import {nodeEngineHost} from './engine/node-engine-host.ts';
import {currentContext, firstCheck} from './engine/preflight.ts';
import {
  commands,
  enabledApiProposals,
  settings,
  standDown,
} from './identifiers.generated.ts';
import {reopenInContainer} from './open/reopen.ts';

/** The warning of a window where the other Dev Containers extension runs, and its button. */
const STAND_DOWN_WARNING =
  'Dev Containers stays inactive in this window because another Dev Containers extension is enabled. Both use the same commands, settings and remote connections. Disable one of the two extensions and reload the window.';
const STAND_DOWN_BUTTON = 'Show Dev Containers Extension';

/** The English templates of the proposed-API setup notices; the placeholders are filled by the setup. */
const SETUP_TEXT_TEMPLATES = {
  setup:
    "{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.",
  failedAttempt:
    "The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-containers', then restart {1}.",
  restart: 'Quit and start {1} again to apply the changes to argv.json.',
  configureButton: 'Configure Runtime Arguments',
  notNowButton: 'Not Now',
  quitButton: 'Quit {1}',
};

/** What the editor tells about the extension, as far as activation reads it. */
interface Manifest {
  displayName: string;
  version: string;
  contributes?: {commands?: Array<{command: string; title: string}>};
}

function translate(template: string): string {
  return vscode.l10n.t(template);
}

/** Called by the editor when the extension activates. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  const profile = profileOf(
    await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'),
  );
  let logChannel: vscode.OutputChannel | undefined;
  const result = await activateContainers({
    table: {commands, standDown},
    standDownTexts: {
      warning: translate(STAND_DOWN_WARNING),
      button: translate(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(vscode),
    commands: identifierHost(vscode, manifest),
    channels: {
      createOutputChannel: name => {
        logChannel = vscode.window.createOutputChannel(name);
        return logChannel;
      },
    },
    clock: Date.now,
    banner: {
      displayName: manifest.displayName,
      extensionVersion: manifest.version,
      editorName: vscode.env.appName,
      editorVersion: vscode.version,
      editorCommit: profile.commit,
    },
    gate: logFailure =>
      familySetupPortsOf(vscode, context, {
        displayName: manifest.displayName,
        proposals: enabledApiProposals,
        viewIds: [],
        templates: SETUP_TEXT_TEMPLATES,
        translate,
        dataFolderName: () => Promise.resolve(profile.dataFolderName),
        logFailure,
      }),
    preflight: logger => ({
      engineFor: nodeEngineHost,
      dockerPath: () =>
        vscode.workspace.getConfiguration().get(settings.dockerPath.id),
      dialogs: {
        showError: (message, detail, items) =>
          Promise.resolve(
            vscode.window.showErrorMessage(
              message,
              {modal: true, detail},
              ...items,
            ),
          ),
        openExternal: address =>
          Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(address))),
        revealLog: () => {
          logChannel?.show(true);
        },
      },
      translate,
      setTimer: (milliseconds, callback) => {
        const timer = setTimeout(callback, milliseconds);
        return () => {
          clearTimeout(timer);
        };
      },
      clock: Date.now,
      logger,
      searchPath: () => process.env.PATH ?? '',
    }),
    handlers: served => {
      function firstFolder(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      }
      return {
        reopenInContainer: {
          execute: reopenInContainer({
            window: {
              remoteName: () => vscode.env.remoteName,
              folders: () =>
                (vscode.workspace.workspaceFolders ?? []).map(folder => ({
                  scheme: folder.uri.scheme,
                  fsPath: folder.uri.fsPath,
                })),
              isTrusted: () => vscode.workspace.isTrusted,
              serializedFile: file => serializedUriOf(vscode.Uri.file(file)),
            },
            files: {
              isFile: file =>
                stat(file).then(
                  found => found.isFile(),
                  () => false,
                ),
              subfolders: folder =>
                readdir(folder, {withFileTypes: true}).then(
                  entries =>
                    entries
                      .filter(entry => entry.isDirectory())
                      .map(entry => entry.name),
                  () => [],
                ),
            },
            settings: {
              dockerPath: () =>
                vscode.workspace.getConfiguration().get(settings.dockerPath.id),
            },
            engine: {
              firstCheck: base =>
                firstCheck(
                  served.preflight,
                  base,
                  new AbortController().signal,
                ),
              currentContext: () =>
                currentContext(
                  served.preflight,
                  firstFolder(),
                  new AbortController().signal,
                ),
            },
            bridge: cliBridgeOf(
              nodeCliHost(
                {...cliPathsOf(context.extensionPath), node: process.execPath},
                process.env,
                systemCliPorts,
              ),
              {readText: file => readFile(file, 'utf8')},
              overrideStoreOf(context.globalStorageUri.fsPath),
              process.env,
              served.logger,
            ),
            opener: {
              executeCommand: (command, ...parameters) =>
                vscode.commands.executeCommand(command, ...parameters),
              addressOf: parts => vscode.Uri.from(parts),
            },
            logger: served.logger,
          }),
        },
      };
    },
  });
  if (result.kind === 'serving') {
    context.subscriptions.push({
      dispose: () => {
        result.dispose();
      },
    });
  }
}
