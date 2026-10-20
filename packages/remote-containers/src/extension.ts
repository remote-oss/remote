/**
 * @fileoverview The entry of Dev Containers in the desktop editor: it hands the editor to the activation, with the
 * proposed-API setup and the strings of the notices.
 */

import {appendFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {familySetupPortsOf, resolverEditorOf} from 'lib-authority';
import {nodeLocalPort, nodePortProber} from 'lib-forwarding';
import {nodeTimer} from 'lib-helper';
import {identifierHost} from 'lib-identifiers';
import type {Logger, RevealableChannel} from 'lib-log';
import {profileOf} from 'lib-product';
import {downloadPortOf, nodeClientFiles, nodeCredentialsPort} from 'lib-server';
import {standDownHost} from 'lib-standdown';
import {containersChannelPortFor} from './acceptance-log.ts';
import {activateContainers} from './activation.ts';
import {serializedUriOf} from './authority/payload.ts';
import {configFilesOf, configSurfacesOf} from './config/config-ports.ts';
import {discoverConfigurations} from './config/discovery.ts';
import {type CliBridge, cliBridgeOf} from './cli/cli-bridge.ts';
import {cliPathsOf} from './cli/cli-paths.ts';
import {nodeCliHost} from './cli/node-cli-host.ts';
import {systemCliPorts} from './cli/node-cli-ports.ts';
import {overrideStoreOf} from './cli/override-files.ts';
import {containerConnectorOf} from './connect/connector.ts';
import {openHostRelay} from './connect/host-relay.ts';
import {
  registerContainerResolver,
  RESOLVER_EDITOR_OPTIONS,
} from './connect/register-connector.ts';
import {runServerSteps} from './connect/server-steps.ts';
import {nodeEngineHost} from './engine/node-engine-host.ts';
import {currentContext, firstCheck} from './engine/preflight.ts';
import {
  commands,
  enabledApiProposals,
  settings,
  standDown,
  views,
} from './identifiers.generated.ts';
import {cacheVolumeOf} from './lifecycle/cache-volume.ts';
import {moveInstallIfLocal} from './extensions/install-if-local.ts';
import {containerLifecycleOf} from './lifecycle/container-lifecycle.ts';
import {openPendingEdit, storePendingEdit} from './open/pending-edit.ts';
import {rebuildContainer} from './open/rebuild.ts';
import {storePausedRetry} from './state/paused-retry.ts';
import {
  offerReopen,
  resetReopenNotification,
} from './open/reopen-notification.ts';
import {openFolderInContainer} from './open/open-folder.ts';
import {reopenHandlersOf} from './open/reopen.ts';
import type {ReopenPorts} from './open/reopen-ports.ts';
import {
  type DetailsView,
  showDetailsWhenRegistered,
} from './explorer/details-view.ts';
import {sharedContainerEvents} from './explorer/targets-events.ts';
import {
  engineOfWindow,
  showTargetsWhenRegistered,
  type TargetsView,
  type TreeItemSpec,
} from './explorer/targets-view.ts';
import {licenceModalOf} from './surfaces/licence-modal.ts';
import {
  lifecyclePresenterOf,
  type StatusProgressPort,
  type TerminalPort,
} from './surfaces/lifecycle-terminal.ts';
import {recoveryPortsOf} from './surfaces/recovery-editor.ts';
import {ensureTrusted} from './trust/trust-gate.ts';

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

/** The folders the window has open, by scheme and path on this machine. */
function windowFolders(): Array<{scheme: string; fsPath: string}> {
  return (vscode.workspace.workspaceFolders ?? []).map(folder => ({
    scheme: folder.uri.scheme,
    fsPath: folder.uri.fsPath,
  }));
}

function translate(template: string): string {
  return vscode.l10n.t(template);
}

/** What the editor asks of a tree whose nodes are `Node`. */
interface TreeProvider<Node> {
  onDidChangeTreeData(listener: () => void): {dispose(): void};
  getChildren(node: Node | undefined): Promise<readonly Node[]>;
  getTreeItem(node: Node): TreeItemSpec;
}

/**
 * The tree view of the editor for `provider`, with each node's item made from what the provider says of it. Its title
 * is set through a cast, since exact optional types do not let a plain assignment give back the registered name with
 * none.
 */
function treeViewOf<Node>(
  viewId: string,
  provider: TreeProvider<Node>,
  extensionUri: vscode.Uri,
) {
  const emitter = new vscode.EventEmitter<undefined>();
  const subscription = provider.onDidChangeTreeData(() => {
    emitter.fire(undefined);
  });
  const treeView = vscode.window.createTreeView<Node>(viewId, {
    treeDataProvider: {
      onDidChangeTreeData: emitter.event,
      getChildren: async node => [...(await provider.getChildren(node))],
      getTreeItem: node => treeItemOf(provider.getTreeItem(node), extensionUri),
    },
    showCollapseAll: false,
  });
  return {
    onDidChangeVisibility: (listener: (visible: boolean) => void) =>
      treeView.onDidChangeVisibility(event => {
        listener(event.visible);
      }),
    setTitle: (title: string | undefined) => {
      (treeView as {title: string | undefined}).title = title;
    },
    dispose: () => {
      treeView.dispose();
      subscription.dispose();
      emitter.dispose();
    },
  };
}

/** The editor's tree item for what the view says of a node; the package's own icons are in its `resources`. */
function treeItemOf(
  spec: TreeItemSpec,
  extensionUri: vscode.Uri,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    spec.label,
    spec.expanded
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None,
  );
  item.id = spec.id;
  if (spec.description !== undefined) {
    item.description = spec.description;
  }
  if (spec.tooltip !== undefined) {
    item.tooltip = spec.tooltip;
  }
  if (spec.contextValue !== undefined) {
    item.contextValue = spec.contextValue;
  }
  if (spec.icon?.kind === 'theme') {
    item.iconPath = new vscode.ThemeIcon(spec.icon.id);
  } else if (spec.icon !== undefined) {
    const file = spec.icon.file;
    item.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'resources', 'light', file),
      dark: vscode.Uri.joinPath(extensionUri, 'resources', 'dark', file),
    };
  }
  return item;
}

/** The editor's terminals as the lifecycle presenter uses them: a pseudoterminal that is transient and takes focus. */
function terminalPortOf(): TerminalPort {
  return {
    open: (name, onInput, onClosed, onDimensions) => {
      const written = new vscode.EventEmitter<string>();
      const early: string[] = [];
      let ready = false;
      const terminal = vscode.window.createTerminal({
        name,
        isTransient: true,
        // eslint-disable-next-line id-length -- the editor's name for the option
        pty: {
          onDidWrite: written.event,
          open: (initialDimensions: vscode.TerminalDimensions | undefined) => {
            if (initialDimensions !== undefined) {
              onDimensions({
                rows: initialDimensions.rows,
                columns: initialDimensions.columns,
              });
            }
            ready = true;
            for (const text of early.splice(0)) {
              written.fire(text);
            }
          },
          close: onClosed,
          handleInput: onInput,
          setDimensions: (dimensions: vscode.TerminalDimensions) => {
            onDimensions({rows: dimensions.rows, columns: dimensions.columns});
          },
        },
      });
      terminal.show(false);
      return {
        write: text => {
          if (ready) {
            written.fire(text);
          } else {
            early.push(text);
          }
        },
        close: () => {
          terminal.dispose();
        },
      };
    },
  };
}

/** The editor's window progress (its status bar entry) as the lifecycle presenter uses it. */
function statusProgressPortOf(): StatusProgressPort {
  return {
    show: title => {
      const ender: {finish?: () => void} = {};
      const finished = new Promise<void>(resolve => {
        ender.finish = resolve;
      });
      void vscode.window.withProgress(
        {location: vscode.ProgressLocation.Window, title},
        () => finished,
      );
      return () => {
        ender.finish?.();
      };
    },
  };
}

/** Called by the editor when the extension activates. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  const profile = profileOf(
    await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'),
  );
  let logChannel: RevealableChannel | undefined;
  const channelPort = containersChannelPortFor(
    process.env,
    vscode.window,
    (file, text) => {
      appendFileSync(file, text);
    },
  );
  const configFiles = configFilesOf(
    {
      readDirectory: folder =>
        vscode.workspace.fs.readDirectory(vscode.Uri.file(folder)),
      readFile: file => vscode.workspace.fs.readFile(vscode.Uri.file(file)),
      stat: path => vscode.workspace.fs.stat(vscode.Uri.file(path)),
    },
    vscode.FileType,
  );
  const collate = new Intl.Collator(undefined, {sensitivity: 'accent'}).compare;
  let targetsView: TargetsView | undefined;
  let detailsView: DetailsView | undefined;
  function bridgeFor(
    environment: Readonly<Record<string, string | undefined>>,
    logger: Logger,
  ): CliBridge {
    return cliBridgeOf(
      nodeCliHost(
        {
          ...cliPathsOf(context.extensionPath, vscode.env.appRoot),
          node: process.execPath,
        },
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
        logChannel = channelPort.createOutputChannel(name);
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
    trust: {
      isTrusted: () => vscode.workspace.isTrusted,
      request: async message =>
        (await vscode.workspace.requestWorkspaceTrust({message})) === true,
    },
    gate: logFailure =>
      familySetupPortsOf(vscode, context, {
        displayName: manifest.displayName,
        proposals: enabledApiProposals,
        viewIds: [views.targetsContainers],
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
      const reopenPorts: ReopenPorts = {
        gate: {
          missing: served.missing,
          setupAgain: () => served.setupAgain(),
          logger: served.logger,
        },
        window: {
          remoteName: () => vscode.env.remoteName,
          folders: windowFolders,
          serializedFile: file => serializedUriOf(vscode.Uri.file(file)),
        },
        ensureTrusted: commandTitle =>
          ensureTrusted(served.trust, {
            translate,
            logger: served.logger,
            setupAgain: () => served.setupAgain(),
            commandTitle,
          }),
        intents: context.globalState,
        now: Date.now,
        config: {
          files: configFiles,
          surfaces: configSurfacesOf(
            {
              createQuickPick: () => vscode.window.createQuickPick(),
              showWarningMessage: (message, options, ...items) =>
                vscode.window.showWarningMessage(message, options, ...items),
              showInformationMessage: message =>
                vscode.window.showInformationMessage(message),
              showTextDocument: (file, options) =>
                vscode.window.showTextDocument(vscode.Uri.file(file), options),
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
          compare: collate,
          translate,
        },
        settings: {
          dockerPath: () =>
            vscode.workspace.getConfiguration().get(settings.dockerPath.id),
          mountGitWorktreeCommonDir: () =>
            vscode.workspace
              .getConfiguration()
              .inspect(settings.experimentalMountGitWorktreeCommonDir.id)
              ?.globalValue,
        },
        engine: {
          firstCheck: (base, dialogs) =>
            firstCheck(
              {...served.preflight, dialogs},
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
        dialogs: served.preflight.dialogs,
        progress: {
          showProgress: (title, until) => {
            void vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: false,
              },
              () => until,
            );
          },
          setTimer: (milliseconds, callback) =>
            served.preflight.setTimer(milliseconds, callback),
          translate,
        },
        bridge: bridgeFor(process.env, served.logger),
        opener: {
          executeCommand: (command, ...parameters) =>
            vscode.commands.executeCommand(command, ...parameters),
          addressOf: parts => vscode.Uri.from(parts),
        },
        logger: served.logger,
      };
      const reopenHandler = reopenHandlersOf(reopenPorts);
      const openFolder = openFolderInContainer({
        ...reopenPorts,
        window: {
          ...reopenPorts.window,
          remoteAuthority: () => vscode.env.remoteAuthority,
          homeFolder: () => os.homedir(),
        },
        pickFolder: async start => {
          const [picked] =
            (await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              defaultUri: vscode.Uri.file(start),
            })) ?? [];
          return picked === undefined
            ? undefined
            : {scheme: picked.scheme, fsPath: picked.fsPath};
        },
      });
      return {
        reopenInContainer: {execute: reopenHandler()},
        openFolder: {execute: openFolder},
        rebuildAndReopenInContainer: {
          execute: reopenHandler({buildNoCache: false}),
        },
        rebuildNoCacheAndReopenInContainer: {
          execute: reopenHandler({buildNoCache: true}),
        },
        rebuildContainer: {execute: rebuildHandler(false)},
        rebuildContainerNoCache: {execute: rebuildHandler(true)},
        explorerTargetsRefresh: {execute: () => targetsView?.refresh()},
        explorerDetailsRefresh: {execute: () => detailsView?.refresh()},
        showReopenInContainerNotificationReset: {
          execute: () =>
            resetReopenNotification(context.globalState, Date.now()),
        },
      };
    },
  });
  if (result.kind === 'serving') {
    const {served} = result;
    const logger = served.logger;
    void openPendingEdit({
      memento: context.globalState,
      remoteName: () => vscode.env.remoteName,
      folders: windowFolders,
      now: Date.now,
      open: file =>
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file)),
      logger,
    });
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
      lifecycleFor: (engine, bridge, presenter) =>
        containerLifecycleOf({
          engine,
          // eslint-disable-next-line id-length -- the lifecycle's dependency is named cli
          cli: bridge,
          logger,
          presenter,
          clock: Date.now,
        }),
      lifecyclePresenter: lifecyclePresenterOf(
        terminalPortOf(),
        statusProgressPortOf(),
        translate,
      ),
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
          cacheVolume: () =>
            cacheVolumeOf(
              configuration.inspect(settings.cacheVolume.id)?.globalValue,
              configuration.inspect(settings.cacheVolume.legacyId)?.globalValue,
            ),
          workspaceMountConsistency: configuration.inspect(
            settings.workspaceMountConsistency.id,
          )?.globalValue,
          legacyWorkspaceMountConsistency: configuration.inspect(
            settings.workspaceMountConsistency.legacyId,
          )?.globalValue,
          mountGitWorktreeCommonDir: configuration.inspect(
            settings.experimentalMountGitWorktreeCommonDir.id,
          )?.globalValue,
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
      trust: served.trust,
      trustNeeds: {
        translate,
        logger: served.logger,
        setupAgain: () => served.setupAgain(),
      },
      showDeclined: async (message, detail) => {
        await vscode.window.showInformationMessage(message, {
          modal: true,
          detail,
        });
      },
      reopenLocally: async hostPath => {
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(hostPath),
          {forceReuseWindow: true},
        );
      },
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
            credentials: nodeCredentialsPort({
              environment: process.env,
              platform: process.platform,
              homeFolder: os.homedir(),
            }),
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
    if (served.missing.length === 0) {
      offerReopen({
        window: {
          remote: vscode.env.remoteName !== undefined,
          workspaceFile: vscode.workspace.workspaceFile !== undefined,
          folders: (vscode.workspace.workspaceFolders ?? []).map(folder => ({
            scheme: folder.uri.scheme,
            fsPath: folder.uri.fsPath,
          })),
        },
        global: context.globalState,
        workspace: context.workspaceState,
        hasConfiguration: async folder =>
          (await discoverConfigurations(folder, configFiles, collate)).length >
          0,
        show: (message, buttons) =>
          vscode.window.showInformationMessage(message, ...buttons),
        reopen: () =>
          vscode.commands.executeCommand(commands.reopenInContainer.id),
        now: Date.now,
        translate,
        logger,
      }).catch((caught: unknown) => {
        logger.error(
          `the reopen notification failed: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      });
    }
    const registered = await registerContainerResolver(
      {
        resolverEditor: resolverEditorOf(vscode, RESOLVER_EDITOR_OPTIONS),
        labels: vscode.workspace,
        commands: host,
        presenter: recoveryPortsOf(vscode, {
          keepEdit: (folder, configFile) =>
            storePendingEdit(
              context.globalState,
              folder,
              configFile,
              Date.now(),
            ),
          storePausedRetry: containerId =>
            storePausedRetry(context.globalState, containerId, Date.now()),
          rebuildContainer: () =>
            vscode.commands.executeCommand(commands.rebuildContainer.id),
          logger,
        }),
        translate,
      },
      connector,
      {
        resolversGranted: !served.missing.includes('resolvers'),
        revealLog: () => {
          logChannel?.show(true);
        },
        logger,
      },
    );
    const explorerEditor = {
      commandIds: () => vscode.commands.getCommands(true),
      setContext: (key: string, value: boolean) =>
        vscode.commands.executeCommand('setContext', key, value),
      createTreeView: <Node>(viewId: string, provider: TreeProvider<Node>) =>
        treeViewOf(viewId, provider, context.extensionUri),
    };
    const windowEngine = {
      dockerPath: () =>
        vscode.workspace.getConfiguration().get(settings.dockerPath.id),
      folders: () =>
        (vscode.workspace.workspaceFolders ?? []).map(
          folder => folder.uri.fsPath,
        ),
      engineFor: (file: string) => served.preflight.engineFor(file),
    };
    const containerEvents = sharedContainerEvents({
      engine: () => engineOfWindow(windowEngine, connector.heldConnection()),
      setTimer: (milliseconds, callback) =>
        served.preflight.setTimer(milliseconds, callback),
      logger,
    });
    targetsView = showTargetsWhenRegistered({
      editor: explorerEditor,
      held: () => connector.heldConnection(),
      ...windowEngine,
      events: containerEvents,
      exists: file =>
        Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.file(file))).then(
          () => true,
          () => false,
        ),
      now: Date.now,
      setTimer: (milliseconds, callback) =>
        served.preflight.setTimer(milliseconds, callback),
      onDockerPathChange: listener =>
        vscode.workspace.onDidChangeConfiguration(event => {
          if (event.affectsConfiguration(settings.dockerPath.id)) {
            listener();
          }
        }),
      translate,
      logger,
    });
    detailsView = showDetailsWhenRegistered({
      editor: explorerEditor,
      held: () => connector.heldConnection(),
      onHeldChanged: listener => connector.onHeldChanged(listener),
      events: containerEvents,
      setTimer: (milliseconds, callback) =>
        served.preflight.setTimer(milliseconds, callback),
      translate,
      logger,
    });
    context.subscriptions.push(
      {
        dispose: () => {
          targetsView?.dispose();
        },
      },
      {
        dispose: () => {
          detailsView?.dispose();
        },
      },
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
