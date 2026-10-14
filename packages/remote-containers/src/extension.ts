/**
 * @fileoverview The entry of Dev Containers in the desktop editor: it hands the editor to the activation, with the
 * proposed-API setup and the strings of the notices.
 */

import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {familySetupPortsOf, resolverEditorOf} from 'lib-authority';
import {nodeLocalPort, nodePortProber} from 'lib-forwarding';
import {nodeTimer} from 'lib-helper';
import {identifierHost} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {profileOf} from 'lib-product';
import {downloadPortOf, nodeClientFiles} from 'lib-server';
import {standDownHost} from 'lib-standdown';
import {activateContainers} from './activation.ts';
import {serializedUriOf} from './authority/payload.ts';
import {configFilesOf, configSurfacesOf} from './config/config-ports.ts';
import {type CliBridge, cliBridgeOf} from './cli/cli-bridge.ts';
import {cliPathsOf} from './cli/cli-paths.ts';
import {nodeCliHost} from './cli/node-cli-host.ts';
import {systemCliPorts} from './cli/node-cli-ports.ts';
import {overrideStoreOf} from './cli/override-files.ts';
import {containerConnectorOf} from './connect/connector.ts';
import {openHostRelay} from './connect/host-relay.ts';
import {registerContainerResolver} from './connect/register-connector.ts';
import {runServerSteps} from './connect/server-steps.ts';
import {nodeEngineHost} from './engine/node-engine-host.ts';
import {currentContext, firstCheck} from './engine/preflight.ts';
import {
  commands,
  enabledApiProposals,
  runtimeCommands,
  settings,
  standDown,
} from './identifiers.generated.ts';
import {moveInstallIfLocal} from './extensions/install-if-local.ts';
import {containerLifecycleOf} from './lifecycle/container-lifecycle.ts';
import {licenceModalOf} from './surfaces/licence-modal.ts';
import {rebuildContainer} from './open/rebuild.ts';
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
  function bridgeFor(
    environment: Readonly<Record<string, string | undefined>>,
    logger: Logger,
  ): CliBridge {
    return cliBridgeOf(
      nodeCliHost(
        {...cliPathsOf(context.extensionPath), node: process.execPath},
        environment,
        systemCliPorts,
      ),
      {readText: file => readFile(file, 'utf8')},
      overrideStoreOf(context.globalStorageUri.fsPath),
      environment,
      logger,
    );
  }
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
      function rebuildHandler(buildNoCache: boolean): () => Promise<void> {
        return rebuildContainer(
          {
            window: {
              remoteName: () => vscode.env.remoteName,
              remoteAuthority: () => vscode.env.remoteAuthority,
              reload: () =>
                vscode.commands.executeCommand('workbench.action.reloadWindow'),
            },
            intents: context.globalState,
            now: Date.now,
            logger: served.logger,
          },
          {buildNoCache},
        );
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
            config: {
              files: configFilesOf(
                {
                  readDirectory: folder =>
                    vscode.workspace.fs.readDirectory(vscode.Uri.file(folder)),
                  readFile: file =>
                    vscode.workspace.fs.readFile(vscode.Uri.file(file)),
                },
                vscode.FileType,
              ),
              surfaces: configSurfacesOf(
                {
                  createQuickPick: () => vscode.window.createQuickPick(),
                  showWarningMessage: (message, options, ...items) =>
                    vscode.window.showWarningMessage(
                      message,
                      options,
                      ...items,
                    ),
                  showInformationMessage: message =>
                    vscode.window.showInformationMessage(message),
                  showTextDocument: (file, options) =>
                    vscode.window.showTextDocument(
                      vscode.Uri.file(file),
                      options,
                    ),
                  iconOf: name => new vscode.ThemeIcon(name),
                },
                {
                  showError: (message, detail, items) =>
                    Promise.resolve(
                      vscode.window.showErrorMessage(
                        message,
                        {modal: true, detail},
                        ...items,
                      ),
                    ),
                  revealLog: () => {
                    logChannel?.show(true);
                  },
                },
                served.logger,
              ),
              compare: new Intl.Collator(undefined, {sensitivity: 'accent'})
                .compare,
              translate,
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
            bridge: bridgeFor(process.env, served.logger),
            opener: {
              executeCommand: (command, ...parameters) =>
                vscode.commands.executeCommand(command, ...parameters),
              addressOf: parts => vscode.Uri.from(parts),
            },
            logger: served.logger,
          }),
        },
        rebuildContainer: {execute: rebuildHandler(false)},
        rebuildContainerNoCache: {execute: rebuildHandler(true)},
      };
    },
  });
  if (result.kind === 'serving') {
    const {served} = result;
    const logger = served.logger;
    const host = identifierHost(vscode, manifest);
    void moveInstallIfLocal({
      userValue: key =>
        vscode.workspace.getConfiguration().inspect(key)?.globalValue,
      writeUserValue: (key, value) =>
        vscode.workspace
          .getConfiguration()
          .update(key, value, vscode.ConfigurationTarget.Global),
      logger,
    });
    const scheduler = {setTimer: nodeTimer};
    const clock = {
      now: Date.now,
      wait: (milliseconds: number) =>
        new Promise<void>(resolve => {
          setTimeout(resolve, milliseconds);
        }),
    };
    const download = downloadPortOf((address, init) => fetch(address, init));
    const acceptances = {
      isAccepted: (storeKey: string) =>
        context.globalState.get(storeKey) === true,
      accept: async (storeKey: string) => {
        await context.globalState.update(storeKey, true);
      },
    };
    const modal = licenceModalOf(
      {
        showModal: (message, detail, buttons) =>
          vscode.window.showWarningMessage(
            message,
            {modal: true, detail},
            ...buttons,
          ),
      },
      translate,
      {
        displayName: manifest.displayName,
        applicationName: profile.applicationName,
      },
    );
    const connector = containerConnectorOf({
      engineFor: file => served.preflight.engineFor(file),
      cliFor: environment => bridgeFor(environment, logger),
      lifecycleFor: (engine, bridge) =>
        // eslint-disable-next-line id-length -- the lifecycle's dependency is named cli
        containerLifecycleOf({engine, cli: bridge, logger}),
      settings: () => {
        const configuration = vscode.workspace.getConfiguration();
        const written = configuration.inspect(
          settings.serverDownloadBaseUrl.id,
        )?.globalValue;
        return {
          dockerPath: configuration.get(settings.dockerPath.id),
          serverDownloadBaseUrl:
            typeof written === 'string' && written !== ''
              ? {value: written, layer: 'defaultProfileUser'}
              : undefined,
          serverDownloadFolder: configuration.get(
            settings.serverDownloadFolder.id,
          ),
          defaultExtensions: configuration.inspect(
            settings.defaultExtensions.id,
          )?.globalValue,
          deprecatedDefaultExtensions: configuration.inspect(
            settings.defaultExtensions.legacyId,
          )?.globalValue,
        };
      },
      preflight: served.preflight,
      editorEnvironment: process.env,
      intents: context.globalState,
      runServer: (request, serverSettings) =>
        runServerSteps(
          {
            profile,
            override: serverSettings.serverDownloadBaseUrl,
            downloadFolder: serverSettings.serverDownloadFolder,
            temporaryFolder: os.tmpdir(),
            store: acceptances,
            modal,
            download,
            files: nodeClientFiles,
            clock,
            newTemporaryToken: () =>
              `${String(process.pid)}-${String(clock.now())}`,
            logger,
          },
          request,
        ),
      openRelay: request =>
        openHostRelay(
          {
            local: nodeLocalPort(),
            prober: nodePortProber(),
            scheduler,
            logger,
          },
          request,
        ),
      clock: Date.now,
      logger,
      revealLog: () => {
        logChannel?.show(true);
      },
    });
    const registered = await registerContainerResolver(
      {
        resolverEditor: resolverEditorOf(vscode, {
          detailsCommand: runtimeCommands.revealLogTerminal,
        }),
        labels: vscode.workspace,
        commands: host,
        presenter: {
          showError: (message, detail, items) =>
            Promise.resolve(
              vscode.window.showErrorMessage(
                message,
                {modal: true, detail},
                ...items,
              ),
            ),
          openSetting: setting =>
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              setting,
            ),
        },
        translate,
      },
      connector,
      {
        resolversGranted: !served.missing.includes('resolvers'),
        revealLog: () => {
          logChannel?.show(true);
        },
      },
    );
    context.subscriptions.push(
      {
        dispose: () => {
          registered.dispose();
        },
      },
      {
        dispose: () => {
          result.dispose();
        },
      },
    );
  }
}
