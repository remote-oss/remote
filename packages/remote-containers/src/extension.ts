/**
 * @fileoverview The entry of Dev Containers in the desktop editor: it hands the editor to the activation, with the
 * proposed-API setup and the strings of the notices.
 */

import {appendFileSync, readFileSync, watch} from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import * as vscode from 'vscode';
import {
  familySetupPortsOf,
  PORTS_VIEW_KEY,
  resolverEditorOf,
} from 'lib-authority';
import {nodeLocalPort, nodePortProber} from 'lib-forwarding';
import {
  acquire,
  askpassEndpointPath,
  nodeClientEnvironment,
  nodeEndpointPort,
  nodeLauncherFiles,
  nodeTimer,
  runtimeFolder,
} from 'lib-helper';
import {type CommandHandler, identifierHost} from 'lib-identifiers';
import type {Logger, RevealableChannel} from 'lib-log';
import {profileOf} from 'lib-product';
import {downloadPortOf, nodeClientFiles, nodeCredentialsPort} from 'lib-server';
import {standDownHost} from 'lib-standdown';
import {containersChannelPortFor} from './acceptance-log.ts';
import {activateContainers} from './activation.ts';
import {serializedUriOf, windowOriginOf} from './authority/payload.ts';
import {manifestStoreOf} from './features/manifest-store.ts';
import {downloadTextOver} from './authoring/catalogue-download.ts';
import {
  addConfiguration,
  savedWorkspaceOf,
  createDevContainerFile,
} from './authoring/create-file.ts';
import type {OptionRow} from './authoring/option-screens.ts';
import type {PickRow} from './authoring/template-pick.ts';
import type {WizardPorts} from './authoring/wizard-stages.ts';
import {
  slotOf,
  storeRootOf,
  type StoreFiles,
} from './authoring/user-data-store.ts';
import {storedCandidate, type StoredLookup} from './config/stored-candidate.ts';
import type {LocationRow} from './authoring/location.ts';
import {wizardRunnerOf} from './authoring/wizard.ts';
import {
  configureFeaturesOf,
  type WindowFolder,
} from './authoring/configure-features.ts';
import {addFilesForFeatures} from './authoring/features-add-files.ts';
import {featuresRunOf} from './authoring/features-run.ts';
import {versionCheckOf} from './authoring/version-check.ts';
import {
  type AuthoringFiles,
  hostFiles,
  isUnder,
  routedFiles,
  windowFiles,
} from './authoring/window-files.ts';
import {finishTooltip} from './authoring/select-features.ts';
import {writeTemplate} from './authoring/write.ts';
import {configFilesOf, configSurfacesOf} from './config/config-ports.ts';
import {discoverConfigurations} from './config/discovery.ts';
import {
  type DiagnosticsHost,
  featureDiagnosticsProviderOf,
} from './config/feature-diagnostics-provider.ts';
import {type CliBridge, cliBridgeOf} from './cli/cli-bridge.ts';
import {cliPathsOf} from './cli/cli-paths.ts';
import {nodeCliHost} from './cli/node-cli-host.ts';
import {systemCliPorts} from './cli/node-cli-ports.ts';
import {overrideStoreOf} from './cli/override-files.ts';
import {containerConnectorOf, noEngineProgramOf} from './connect/connector.ts';
import {openHostRelay} from './connect/host-relay.ts';
import {recentLabelPortsOf} from './connect/recent-editor.ts';
import {
  registerContainerResolver,
  RESOLVER_EDITOR_OPTIONS,
} from './connect/register-connector.ts';
import {runServerSteps} from './connect/server-steps.ts';
import {folderDialogOptions} from './open/folder-dialog.ts';
import {reopenOriginHandlersOf} from './open/reopen-origin.ts';
import {
  type EngineSources,
  engineEnvironment,
  type PinnedEngine,
  pinnedEngineOf,
  withAmbientContext,
  withEnvironment,
} from './engine/effective-engine.ts';
import {configWatchOf} from './config-watch/config-watch.ts';
import {engineBaseOf, executableOf} from './engine/executable.ts';
import {nodeEngineHost} from './engine/node-engine-host.ts';
import {composeCheck, currentContext, firstCheck} from './engine/preflight.ts';
import {type AskpassRelay, openAskpassRelay} from './volumes/askpass-relay.ts';
import {
  CLONE_TRUST_KEY,
  CLONE_TRUST_PAGE,
  cloneInUniqueVolume,
} from './volumes/clone-command.ts';
import {
  clearTypedSource,
  storeTypedSource,
  typedSourceRecorded,
} from './volumes/typed-source.ts';
import {bootstrapSettingsOf} from './volumes/bootstrap.ts';
import {
  bootstrapFilesOf,
  bootstrapOverrideStoreOf,
} from './volumes/bootstrap-files.ts';
import {writeBuildContext} from './volumes/build-context.ts';
import {volumeRewriteOf} from './volumes/volume-rewrite.ts';
import {containerCliHost} from './cli/container-cli-host.ts';
import {ownText} from './surfaces/own-strings.ts';
import {cloneText} from './volumes/clone-strings.ts';
import type {ClonePromptSurface} from './volumes/git-prompts.ts';
import {runHostProgram} from './volumes/host-program.ts';
import {precheck} from './volumes/precheck.ts';
import {sourceRowsOf} from './volumes/source-pick.ts';
import {volumeTargetOf} from './volumes/volume-payload.ts';
import {composeRouteOf} from './engine/compose-route.ts';
import {effectiveEngineKey} from './engine/engine-key.ts';
import {engineWatchOf} from './engine/engine-watch.ts';
import {
  commands,
  contextKeys,
  enabledApiProposals,
  settings,
  standDown,
  views,
} from './identifiers.generated.ts';
import {cacheVolumeOf} from './lifecycle/cache-volume.ts';
import {moveInstallIfLocal} from './extensions/install-if-local.ts';
import {composeResolverOf} from './compose/resolver.ts';
import {MOUNT_PERFORMANCE_PAGE} from './surfaces/recovery-presenter.ts';
import {gitRemoteOf} from './open/git-remote.ts';

import {containerLifecycleOf} from './lifecycle/container-lifecycle.ts';
import {createAttemptLog, writeAttemptLog} from './connect/attempt-log.ts';
import {openPendingEdit, storePendingEdit} from './open/pending-edit.ts';
import {rebuildContainer} from './open/rebuild.ts';
import {storePausedRetry} from './state/paused-retry.ts';
import {
  type NotificationVariant,
  offerReopen,
  resetReopenNotification,
} from './open/reopen-notification.ts';
import {openFolderInContainer} from './open/open-folder.ts';
import {
  SHUTDOWN_CLIENT_WAITS,
  shutdownHelperRequest,
} from './shutdown/helper-request.ts';
import {createWindowLease} from './shutdown/window-lease.ts';
import {forwarderOf, type TunnelHost} from './ports/forwarder.ts';
import {reopenHandlersOf} from './open/reopen.ts';
import type {ReopenPorts} from './open/reopen-ports.ts';
import {
  type DetailsView,
  showDetailsWhenRegistered,
} from './explorer/details-view.ts';
import {mountPerformanceHintApplies} from './explorer/details-model.ts';
import {containerLogOf} from './explorer/container-log.ts';
import {inspectOf} from './explorer/inspect.ts';
import {
  containerRowOf,
  type RowActions,
  rowActionsOf,
} from './explorer/row-actions.ts';
import {rowOpenOf} from './explorer/row-open.ts';
import {sharedContainerEvents} from './explorer/targets-events.ts';
import {registeredNameOf} from './explorer/view-name.ts';
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
import {openOwnSettings} from './settings/settings-command.ts';

/** The command that clones a repository in a volume, which the clone offer of the reopen notification starts once the package registers it. */
const CLONE_IN_VOLUME_COMMAND = 'remote-containers.cloneInVolume';

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

/** The folders the window has open, by scheme, path on this machine and path in the folder's own file system. */
function windowFolders(): Array<{
  scheme: string;
  fsPath: string;
  path: string;
}> {
  return (vscode.workspace.workspaceFolders ?? []).map(folder => ({
    scheme: folder.uri.scheme,
    fsPath: folder.uri.fsPath,
    path: folder.uri.path,
  }));
}

/**
 * The path in the container of the only folder of a dev container window; none in any other window. Read at each call,
 * because the window's folders can change.
 */
function containerFolder(): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const [only] = folders;
  return folders.length === 1 &&
    only?.uri.scheme === 'vscode-remote' &&
    vscode.env.remoteName === 'dev-container'
    ? only.uri.path
    : undefined;
}

/** The address of a path the authoring command uses: in the container for a path of the window's folder, else here. */
function authoringUriOf(file: string): vscode.Uri {
  const root = containerFolder();
  const [folder] = vscode.workspace.workspaceFolders ?? [];
  return root !== undefined && folder !== undefined && isUnder(root, file)
    ? folder.uri.with({path: file})
    : vscode.Uri.file(file);
}

/** The wizard's ports with no choice of where the files go: for a window whose files can only go to its own host. */
function withoutLocation(ports: WizardPorts): WizardPorts {
  const copy = {...ports};
  delete copy.location;
  return copy;
}

function translate(template: string): string {
  return vscode.l10n.t(template);
}

/** A modal dialog with the buttons, the first the primary one and Cancel the close affordance; gives the title chosen. */
async function modalShown(
  severity: 'error' | 'info',
  message: string,
  detail: string,
  buttons: readonly string[],
): Promise<string | undefined> {
  const cancel = translate('Cancel');
  const items = buttons.map(title => ({
    title,
    isCloseAffordance: title === cancel,
  }));
  const chosen =
    severity === 'error'
      ? await vscode.window.showErrorMessage(
          message,
          {modal: true, detail},
          ...items,
        )
      : await vscode.window.showInformationMessage(
          message,
          {modal: true, detail},
          ...items,
        );
  return chosen?.title;
}

/** What the editor asks of a tree whose nodes are `Node`. */
interface TreeProvider<Node> {
  onDidChangeTreeData(listener: () => void): {dispose(): void};
  getChildren(node: Node | undefined): Promise<readonly Node[]>;
  getTreeItem(node: Node): TreeItemSpec;
}

/**
 * The tree view of the editor for `provider`, with each node's item made from what the provider says of it. Its title
 * is set through a cast, since exact optional types do not let a plain assignment clear it; giving none leaves the
 * header blank, so none brings back the name the manifest gives the view.
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
  /** The text of the strings file `file` of the extension, or none when it can't be read. */
  function readStrings(file: string): string | undefined {
    try {
      return readFileSync(path.join(extensionUri.fsPath, file), 'utf8');
    } catch {
      return undefined;
    }
  }
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
      (treeView as {title: string | undefined}).title =
        title ?? registeredNameOf(readStrings, vscode.env.language, viewId);
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

/** The places of a window's folders where dev container configurations are: the dotfile and the `.devcontainer` folder. */
const CONFIGURATION_PATTERN =
  '{.devcontainer.json,.devcontainer/**/devcontainer.json}';

/** The editor behind the diagnostics of the Feature ids. */
function featureDiagnosticsHost(): DiagnosticsHost {
  const collection = vscode.languages.createDiagnosticCollection(
    'dev-containers-features',
  );
  return {
    folders: () =>
      (vscode.workspace.workspaceFolders ?? []).map(each => each.uri.fsPath),
    onFoldersChanged: listener =>
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        listener();
      }),
    findConfigurations: async folder =>
      (
        await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, CONFIGURATION_PATTERN),
          null,
        )
      ).map(each => each.fsPath),
    readFromDisk: async file => {
      try {
        return new TextDecoder().decode(
          await vscode.workspace.fs.readFile(vscode.Uri.file(file)),
        );
      } catch {
        return undefined;
      }
    },
    openText: file =>
      vscode.workspace.textDocuments
        .find(each => each.uri.fsPath === file)
        ?.getText(),
    watch: (folder, listener) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, CONFIGURATION_PATTERN),
      );
      const subscriptions = [
        watcher.onDidCreate(each => {
          listener(each.fsPath);
        }),
        watcher.onDidChange(each => {
          listener(each.fsPath);
        }),
        watcher.onDidDelete(each => {
          listener(each.fsPath);
        }),
      ];
      return {
        dispose: () => {
          for (const subscription of subscriptions) {
            subscription.dispose();
          }
          watcher.dispose();
        },
      };
    },
    onTextChanged: listener =>
      vscode.workspace.onDidChangeTextDocument(event => {
        listener(event.document.uri.fsPath);
      }),
    setDiagnostics: (file, diagnostics) => {
      collection.set(
        vscode.Uri.file(file),
        diagnostics.map(each => {
          const shown = new vscode.Diagnostic(
            new vscode.Range(
              each.range.start.line,
              each.range.start.character,
              each.range.end.line,
              each.range.end.character,
            ),
            each.message,
            vscode.DiagnosticSeverity.Error,
          );
          shown.code = {
            value: each.code.value,
            target: vscode.Uri.parse(each.code.target),
          };
          return shown;
        }),
      );
    },
    deleteDiagnostics: file => {
      collection.delete(vscode.Uri.file(file));
    },
    dispose: () => {
      collection.dispose();
    },
  };
}

/** The sources of the effective engine, read from the editor as they are now. */
function engineSources(): EngineSources {
  const configuration = vscode.workspace.getConfiguration();
  return {
    containersEnvironment: configuration.get('containers.environment'),
    dockerEnvironment: configuration.get('docker.environment'),
    dockerHost: configuration.get('docker.host'),
    certPath: configuration.get('docker.certPath'),
    tlsVerify: configuration.get('docker.tlsVerify'),
    processEnvironment: process.env,
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
  /** The lines of the connect attempt that is running or has failed, which a failure dialog writes to a file. */
  const attemptLog = createAttemptLog();
  /** Tells the shutdown helper that this window leaves its container; the connector gives it once it exists. */
  const windowShutdown = {leave: (): Promise<void> => Promise.resolve()};
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
  /** The extension's store of configurations outside the workspace, which the open commands and the wizard look in. */
  const userDataStore: StoreFiles = {
    folderNames: async folder =>
      (await readdir(folder, {withFileTypes: true}).catch(() => []))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name),
    readText: file => readFile(file, 'utf8').catch(() => undefined),
  };
  const storedLookup: StoredLookup = {
    root: storeRootOf(context.globalStorageUri.fsPath),
    store: userDataStore,
    home: os.homedir(),
  };
  let targetsView: TargetsView | undefined;
  let detailsView: DetailsView | undefined;
  let rowActions: RowActions | undefined;
  let inspectRow: ((argument: unknown) => Promise<void>) | undefined;
  let showContainerLog: ((argument: unknown) => Promise<void>) | undefined;
  function bridgeFor(
    environment: Readonly<Record<string, string | undefined>>,
    logger: Logger,
    volume?: {
      configText: string;
      rewrite: (configText: string) => string | undefined;
    },
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
      volume === undefined
        ? {readText: file => readFile(file, 'utf8')}
        : {readText: () => Promise.resolve(volume.configText)},
      overrideStoreOf(context.globalStorageUri.fsPath),
      environment,
      logger,
      ...(volume === undefined ? [] : [volume.rewrite]),
    );
  }
  /** Offers to reopen the window's folder in its container, over what the window holds now. */
  function offerReopenFor(
    logger: Logger,
    variant: NotificationVariant = 'folder',
  ): Promise<void> {
    return offerReopen(
      {
        window: {
          remote: vscode.env.remoteName !== undefined,
          workspace:
            vscode.workspace.workspaceFile === undefined
              ? 'none'
              : vscode.workspace.workspaceFile.scheme === 'file'
                ? 'saved'
                : 'untitled',
          folders: windowFolders(),
        },
        global: context.globalState,
        workspace: context.workspaceState,
        ...(process.platform === 'linux'
          ? {}
          : {
              cloning: {
                remoteOf: async folder =>
                  (await vscode.commands.getCommands(true)).includes(
                    CLONE_IN_VOLUME_COMMAND,
                  )
                    ? gitRemoteOf(
                        await readFile(`${folder}/.git/config`, 'utf8').catch(
                          () => '',
                        ),
                      )
                    : undefined,
                start: remote =>
                  vscode.commands.executeCommand(
                    CLONE_IN_VOLUME_COMMAND,
                    remote,
                  ),
              },
            }),
        configurationKind: async folder => {
          if (
            (await slotOf(storedLookup.root, folder, userDataStore)) !==
            undefined
          ) {
            return 'stored';
          }
          return (await discoverConfigurations(folder, configFiles, collate))
            .length > 0
            ? 'folder'
            : 'none';
        },
        show: (message, buttons) =>
          vscode.window.showInformationMessage(message, ...buttons),
        reopen: () =>
          vscode.commands.executeCommand(commands.reopenInContainer.id),
        now: Date.now,
        translate,
        logger,
      },
      variant,
    );
  }
  const {openInformationAboutMountPerformance, ...activationCommands} =
    commands;
  const result = await activateContainers({
    table: {commands: activationCommands, standDown},
    deferred: {openInformationAboutMountPerformance},
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
    alsoLogTo: attemptLog,
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
        homeFolder: os.homedir(),
        platform: process.platform,
        dataFolderName: () => Promise.resolve(profile.dataFolderName),
        logFailure,
      }),
    preflight: logger => ({
      engineFor: file =>
        withEnvironment(nodeEngineHost(file), () =>
          engineEnvironment(engineSources()),
        ),
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
      /** The engine a window opened from here is pinned to: the settings' and the current context's. */
      async function windowPinnedEngine(): Promise<PinnedEngine> {
        return pinnedEngineOf(
          withAmbientContext(
            engineEnvironment(engineSources()),
            await currentContext(
              served.preflight,
              engineBaseOf({
                folder: firstFolder(),
                trusted: vscode.workspace.isTrusted,
              }),
              new AbortController().signal,
            ),
          ),
        );
      }
      /** Clone Repository in Container Volume's command, over the editor and this machine. */
      function cloneCommand(): CommandHandler {
        let engine: PinnedEngine = {};
        return {
          execute: async () => {
            engine = await windowPinnedEngine();
            await cloneInUniqueVolume(
              {
                trust: {
                  accepted: () =>
                    context.globalState.get(CLONE_TRUST_KEY) === true,
                  confirm: async () => {
                    const learnMore = cloneText('learnMore', translate);
                    const gotIt = cloneText('gotIt', translate);
                    const answer = await vscode.window.showWarningMessage(
                      cloneText('S075', translate),
                      {modal: true, detail: cloneText('S252', translate)},
                      learnMore,
                      gotIt,
                    );
                    if (answer === gotIt) {
                      return 'gotIt';
                    }
                    return answer === learnMore ? 'learnMore' : 'cancel';
                  },
                  remember: async () => {
                    await context.globalState.update(CLONE_TRUST_KEY, true);
                  },
                  learnMore: () => {
                    void vscode.env.openExternal(
                      vscode.Uri.parse(CLONE_TRUST_PAGE),
                    );
                  },
                },
                engineReady: async () =>
                  (await firstCheck(
                    served.preflight,
                    engineBaseOf({
                      folder: firstFolder(),
                      trusted: vscode.workspace.isTrusted,
                    }),
                    new AbortController().signal,
                  )) === 'proceed',
                pickSource: () => pickCloneSource(),
                precheck: (source, cancellation) =>
                  precheck(
                    source,
                    'typed',
                    {
                      openRelay: () => openCloneRelay(),
                      runGit: (gitArguments, environment, signal) =>
                        runHostProgram(
                          'git',
                          gitArguments,
                          environment,
                          signal,
                        ),
                    },
                    cancellation,
                  ),
                cannotAccess: async repository => {
                  await vscode.window.showErrorMessage(
                    cloneText('S052', translate, [repository]),
                    {modal: true},
                  );
                },
                currentRepository: () => {
                  const authority = vscode.env.remoteAuthority ?? '';
                  return authority.startsWith('dev-container+')
                    ? volumeTargetOf(authority.slice('dev-container+'.length))
                        ?.repositoryPath
                    : undefined;
                },
                engine: () => engine,
                recordTyped: payload =>
                  storeTypedSource(context.globalState, payload, Date.now()),
                reload: async uri => {
                  await vscode.commands.executeCommand(
                    'vscode.openFolder',
                    vscode.Uri.parse(uri),
                    {forceReuseWindow: true},
                  );
                },
                logger: served.logger,
              },
              new AbortController().signal,
            );
          },
        };
      }
      /** The source pick: one row that clones the typed text, once there is text; the text, or nothing for Escape. */
      function pickCloneSource(): Promise<string | undefined> {
        const picker = vscode.window.createQuickPick();
        picker.placeholder = cloneText('sourcePlaceholder', translate);
        picker.onDidChangeValue(value => {
          picker.items = sourceRowsOf(value, translate);
        });
        return new Promise(resolve => {
          picker.onDidAccept(() => {
            const chosen = picker.selectedItems[0] ?? picker.items[0];
            resolve(chosen?.description);
            picker.dispose();
          });
          picker.onDidHide(() => {
            resolve(undefined);
            picker.dispose();
          });
          picker.show();
        });
      }
      /** The askpass relay of a clone's check, its endpoint in this user's runtime folder. */
      function openCloneRelay(): Promise<AskpassRelay> {
        const folder = runtimeFolder(
          process.platform,
          process.env,
          os.tmpdir(),
        );
        const nonce = randomBytes(16).toString('hex');
        return openAskpassRelay({
          port: nodeEndpointPort(process.platform),
          files: nodeLauncherFiles,
          scheduler: {setTimer: nodeTimer},
          places: {
            endpoint: askpassEndpointPath(
              process.platform,
              folder,
              'clone',
              nonce,
            ),
            runtimeFolder: folder,
            runtime: process.execPath,
            program: path.join(context.extensionPath, 'dist', 'askpass.js'),
          },
          newNonce: () => nonce,
          askUser: question => askCloneQuestion(question),
          logLine: line => {
            served.logger.info(line);
          },
        });
      }
      /** One question of a clone's check, shown as its kind says; the answer, or nothing when dismissed. */
      async function askCloneQuestion(question: {
        surface: ClonePromptSurface;
        text: string;
      }): Promise<string | undefined> {
        if (question.surface === 'hostKeyPick') {
          const proceed = cloneText('hostKeyContinue', translate);
          const picked = await vscode.window.showQuickPick([proceed], {
            placeHolder: question.text,
            ignoreFocusOut: false,
          });
          return picked === proceed ? 'yes' : undefined;
        }
        return vscode.window.showInputBox({
          prompt: question.text,
          password: question.surface === 'maskedInput',
          ignoreFocusOut: true,
        });
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
            shutdown: {leave: () => windowShutdown.leave()},
            logger: served.logger,
          },
          {buildNoCache},
        );
      }
      const bridge = bridgeFor(process.env, served.logger);
      const authoringFiles = routedFiles(
        hostFiles(),
        windowFiles(
          vscode.workspace.fs,
          {
            file: vscode.FileType.File,
            directory: vscode.FileType.Directory,
          },
          authoringUriOf,
        ),
        containerFolder,
      );
      const wizardPorts: WizardPorts = {
        catalogue: {
          environment: process.env,
          download: downloadTextOver((address, init) => fetch(address, init)),
          setTimer: (milliseconds, callback) => {
            const timer = setTimeout(callback, milliseconds);
            return () => {
              clearTimeout(timer);
            };
          },
        },
        dialogs: {
          showModalError: message =>
            vscode.window.showErrorMessage(message, {modal: true}),
        },
        pick: {
          createQuickPick: () =>
            vscode.window.createQuickPick<PickRow & vscode.QuickPickItem>(),
          verifiedIcon: new vscode.ThemeIcon('verified'),
          openFileIcon: new vscode.ThemeIcon('go-to-file'),
          openExternal: address =>
            vscode.env.openExternal(vscode.Uri.parse(address)),
          templateMetadata: (templateId, cancellation) =>
            bridge.templateMetadata(templateId, cancellation),
          translate,
        },
        options: {
          createQuickPick: () =>
            vscode.window.createQuickPick<OptionRow & vscode.QuickPickItem>(),
          backButton: vscode.QuickInputButtons.Back,
          finishButton: {
            iconPath: new vscode.ThemeIcon('check-all'),
            tooltip: finishTooltip(translate),
          },
          verifiedIcon: new vscode.ThemeIcon('verified'),
        },
        write: (request, cancellation) =>
          writeTemplate(
            request,
            {
              applyTemplate: (applying, onLine, cancelling) =>
                bridge.applyTemplate(applying, onLine, cancelling),
              files: {
                makeScratchFolder: async () => {
                  await mkdir(context.globalStorageUri.fsPath, {
                    recursive: true,
                  });
                  return mkdtemp(
                    path.join(context.globalStorageUri.fsPath, 'template-'),
                  );
                },
                ...authoringFiles,
              },
              dialogs: {
                show: modalShown,
                revealLog: () => {
                  logChannel?.show(true);
                },
              },
              hasUnsavedChanges: file =>
                vscode.workspace.textDocuments.some(
                  document =>
                    document.isDirty &&
                    document.uri.toString() === authoringUriOf(file).toString(),
                ),
              withProgress: (title, work) =>
                Promise.resolve(
                  vscode.window.withProgress(
                    {
                      location: vscode.ProgressLocation.Notification,
                      title,
                      cancellable: false,
                    },
                    work,
                  ),
                ),
              logLine: line => {
                served.logger.info(line);
              },
              translate,
            },
            cancellation,
          ),
        files: authoringFiles,
        stored: {
          files: authoringFiles,
          show: modalShown,
          translate,
        },
        slotFolder: slot =>
          path.join(storeRootOf(context.globalStorageUri.fsPath), slot),
        location: {
          createQuickPick: () =>
            vscode.window.createQuickPick<LocationRow & vscode.QuickPickItem>(),
          storeRoot: storedLookup.root,
          store: userDataStore,
          home: storedLookup.home,
          // The store is on this machine, and a window whose folder is in a container must not create it from there.
          ...(vscode.env.remoteName === 'dev-container'
            ? {
                refuseStore: (folder: string) =>
                  vscode.FileSystemError.NoPermissions(
                    `permission denied, mkdir '${folder}'`,
                  ),
              }
            : {}),
        },
        record: (line, level) => {
          if (level === 'warn') {
            served.logger.warn(line);
          } else {
            served.logger.info(line);
          }
        },
        translate,
      };
      const wizardFor = wizardRunnerOf(wizardPorts);
      // An open command authors in the folder it opens: in a saved multi-root workspace, its file's folder.
      function windowRoots(): string[] {
        return (
          savedWorkspaceOf(windowFolders(), vscode.workspace.workspaceFile)
            ?.roots ?? []
        );
      }
      const authoring = {
        execute: (folder: string) => wizardFor(folder, windowRoots()),
      };
      const continuation = {
        wizard: wizardFor,
        openPreview: (file: string) =>
          vscode.window.showTextDocument(authoringUriOf(file), {
            preview: true,
          }),
        offerReopen: (variant: NotificationVariant) => {
          offerReopenFor(served.logger, variant).catch((caught: unknown) => {
            served.logger.error(
              `the reopen notification failed: ${caught instanceof Error ? caught.message : String(caught)}`,
            );
          });
        },
        logger: served.logger,
      };
      const configSurfaces = configSurfacesOf(
        {
          createQuickPick: () => vscode.window.createQuickPick(),
          showWarningMessage: (message, options, ...items) =>
            vscode.window.showWarningMessage(message, options, ...items),
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
      );
      const reopenPorts: ReopenPorts = {
        authoring,
        gate: {
          missing: served.missing,
          setupAgain: () => served.setupAgain(),
          logger: served.logger,
        },
        window: {
          remoteName: () => vscode.env.remoteName,
          folders: windowFolders,
          workspaceFile: () => {
            const file = vscode.workspace.workspaceFile;
            return file === undefined
              ? undefined
              : {scheme: file.scheme, fsPath: file.fsPath};
          },
          serializedFile: file => serializedUriOf(vscode.Uri.file(file)),
        },
        informModal: text =>
          vscode.window.showInformationMessage('', {
            modal: true,
            detail: text,
          }),
        readWorkspaceFile: async file => {
          try {
            return {kind: 'text', text: await readFile(file, 'utf8')};
          } catch (caught) {
            return {
              kind: 'unreadable',
              message:
                caught instanceof Error ? caught.message : String(caught),
            };
          }
        },
        confirmModal: async text => {
          const proceed = translate('Continue');
          return (
            (await vscode.window.showInformationMessage(
              '',
              {modal: true, detail: text},
              proceed,
            )) === proceed
          );
        },
        translate,
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
          surfaces: configSurfaces,
          composeCheck: (base, dialogs, cancellation) =>
            composeCheck(
              {
                ...served.preflight,
                dialogs: {
                  ...dialogs,
                  openExternal: address =>
                    Promise.resolve(
                      vscode.env.openExternal(vscode.Uri.parse(address)),
                    ),
                },
                composePath: () =>
                  vscode.workspace
                    .getConfiguration()
                    .get(settings.dockerComposePath.id),
              },
              engineBaseOf({folder: base, trusted: vscode.workspace.isTrusted}),
              cancellation,
            ),
          compare: collate,
          stored: folder => storedCandidate(storedLookup, folder),
          useTemplate: folder =>
            addConfiguration(continuation, folder, windowRoots()),
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
          defaultFeatures: () =>
            vscode.workspace
              .getConfiguration()
              .inspect(settings.defaultFeatures.id)?.globalValue,
          lockfile: () =>
            vscode.workspace.getConfiguration().inspect(settings.lockfile.id)
              ?.globalValue,
        },
        engine: {
          firstCheck: (base, dialogs, cancellation) =>
            firstCheck(
              {...served.preflight, dialogs},
              base,
              cancellation ?? new AbortController().signal,
            ),
          pinnedEngine: windowPinnedEngine,
        },
        dialogs: served.preflight.dialogs,
        progress: {
          showProgress: (title, until, cancel) => {
            void vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title,
                cancellable: true,
              },
              (progress, token) => {
                token.onCancellationRequested(cancel);
                return until;
              },
            );
          },
          setTimer: (milliseconds, callback) =>
            served.preflight.setTimer(milliseconds, callback),
          translate,
        },
        bridge,
        clock: Date.now,
        problematic: {
          manifest: {
            environment: process.env,
            download: downloadTextOver((address, init) => fetch(address, init)),
            ...manifestStoreOf(context.globalStorageUri.fsPath),
            now: Date.now,
            setTimer: (milliseconds, callback) => {
              const timer = setTimeout(callback, milliseconds);
              return () => {
                clearTimeout(timer);
              };
            },
            translate,
            logger: served.logger,
          },
          warn: async (message, detail, learnMore, cancel) => {
            const chosen = await vscode.window.showWarningMessage(
              message,
              {modal: true, detail},
              ...(learnMore === undefined ? [] : [{title: learnMore}]),
              {title: cancel, isCloseAffordance: true},
            );
            return learnMore !== undefined && chosen?.title === learnMore
              ? 'learnMore'
              : 'cancel';
          },
          openExternal: address =>
            vscode.env.openExternal(vscode.Uri.parse(address)),
        },
        opener: {
          executeCommand: (command, ...parameters) =>
            vscode.commands.executeCommand(command, ...parameters),
          addressOf: parts => vscode.Uri.from(parts),
        },
        shutdown: {leave: () => windowShutdown.leave()},
        logger: served.logger,
      };
      const reopenHandler = reopenHandlersOf(reopenPorts);
      const rowOpen = rowOpenOf({
        ...reopenPorts,
        window: {
          serializedFile: file => reopenPorts.window.serializedFile(file),
        },
        engineFor: file => served.preflight.engineFor(file),
        exists: file =>
          Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.file(file))).then(
            () => true,
            () => false,
          ),
        cancellation: new AbortController().signal,
      });
      const openFolder = openFolderInContainer({
        ...reopenPorts,
        window: {
          ...reopenPorts.window,
          remoteAuthority: () => vscode.env.remoteAuthority,
          homeFolder: () => os.homedir(),
          isTrusted: () => vscode.workspace.isTrusted,
        },
        pickFolder: async start => {
          const [picked] =
            (await vscode.window.showOpenDialog({
              ...folderDialogOptions(translate),
              defaultUri: vscode.Uri.file(start),
            })) ?? [];
          return picked === undefined
            ? undefined
            : {scheme: picked.scheme, fsPath: picked.fsPath};
        },
      });
      const reopenOrigin = reopenOriginHandlersOf({
        origin: () =>
          served.missing.includes('resolvers')
            ? undefined
            : windowOriginOf(
                vscode.env.remoteAuthority,
                process.platform,
                vscode.workspace.workspaceFile?.path,
              ),
        folderOpen: () => (vscode.workspace.workspaceFolders ?? []).length > 0,
        opener: reopenPorts.opener,
        inform: text => {
          void vscode.window.showInformationMessage(text);
        },
        translate,
      });
      /** The address of a path in the file system of `root`: a folder of a remote window addresses its own host. */
      function addressIn(
        root: WindowFolder | undefined,
        file: string,
      ): vscode.Uri {
        const folder =
          root === undefined || root.scheme === 'file'
            ? undefined
            : (vscode.workspace.workspaceFolders ?? []).find(
                each =>
                  each.uri.scheme === root.scheme &&
                  each.uri.path === root.path,
              );
        return folder === undefined
          ? vscode.Uri.file(file)
          : folder.uri.with({path: file});
      }
      /** The window's files under the address of `root`. */
      function filesUnder(root: WindowFolder | undefined): AuthoringFiles {
        return windowFiles(
          vscode.workspace.fs,
          {file: vscode.FileType.File, directory: vscode.FileType.Directory},
          file => addressIn(root, file),
        );
      }
      const configureFeatures = configureFeaturesOf({
        window: {
          folders: windowFolders,
          remoteName: () => vscode.env.remoteName,
        },
        filesOf: filesUnder,
        hostFiles: hostFiles(),
        compare: collate,
        stored: folder => storedCandidate(storedLookup, folder),
        surfaces: {
          pick: (rows, placeholder, tooltip) =>
            configSurfaces.pick(rows, placeholder, tooltip),
          openPreview: (file, root) =>
            vscode.window.showTextDocument(addressIn(root, file), {
              preview: true,
            }),
          showModal: (detail, buttons) =>
            vscode.window.showInformationMessage(
              '',
              {modal: true, detail},
              ...buttons,
            ),
          showError: (message, detail, items) =>
            configSurfaces.dialogs.showError(message, detail, items),
          revealLog: () => {
            configSurfaces.dialogs.revealLog();
          },
        },
        addFiles: () =>
          addFilesForFeatures({
            window: {
              folders: windowFolders,
              remoteName: () => vscode.env.remoteName,
              workspaceFile: () => {
                const file = vscode.workspace.workspaceFile;
                return file === undefined
                  ? undefined
                  : {scheme: file.scheme, fsPath: file.fsPath};
              },
            },
            informModal: text => reopenPorts.informModal(text),
            addConfiguration: (folder, roots) =>
              addConfiguration(continuation, folder, roots),
            addHostConfiguration: folder => {
              const hostFiles = filesUnder(
                windowFolders().find(each => each.scheme === 'vscode-remote'),
              );
              return addConfiguration(
                {
                  ...continuation,
                  wizard: wizardRunnerOf({
                    ...withoutLocation(wizardPorts),
                    files: hostFiles,
                    stored: {...wizardPorts.stored, files: hostFiles},
                  }),
                  openPreview: file =>
                    vscode.window.showTextDocument(
                      addressIn(
                        windowFolders().find(
                          each => each.scheme === 'vscode-remote',
                        ),
                        file,
                      ),
                      {preview: true},
                    ),
                  offerReopen: () => undefined,
                },
                folder,
                [],
              );
            },
            readWorkspaceFile: file => reopenPorts.readWorkspaceFile(file),
            confirmModal: text => reopenPorts.confirmModal(text),
            translate,
            logger: served.logger,
          }),
        features: featuresRunOf({
          catalogue: wizardPorts.catalogue,
          quick: {...wizardPorts.options, translate},
          showError: (message, detail) =>
            vscode.window.showErrorMessage(message, {modal: true, detail}),
          openPreview: (file, root) =>
            vscode.window.showTextDocument(addressIn(root, file), {
              preview: true,
              selection: new vscode.Range(0, 0, 0, 0),
            }),
          versionCheck: versionCheckOf({
            outdated: (target, cancellation) =>
              bridge.outdated(target, cancellation),
            scratch: async text => {
              const folder = await mkdtemp(
                path.join(os.tmpdir(), 'remote-containers-versions-'),
              );
              await mkdir(path.join(folder, '.devcontainer'));
              const file = path.join(
                folder,
                '.devcontainer',
                'devcontainer.json',
              );
              await writeFile(file, text);
              return {folder, file};
            },
            discard: folder => rm(folder, {recursive: true, force: true}),
            logger: served.logger,
          }),
          translate,
          logger: served.logger,
        }),
        translate,
        logger: served.logger,
      });
      return {
        reopenInContainer: {execute: reopenHandler()},
        reopenLocally: {execute: reopenOrigin.reopenLocally},
        reopenInSSH: {execute: reopenOrigin.reopenInSSH},
        reopenInWSL: {execute: reopenOrigin.reopenInWSL},
        reopenInTunnel: {execute: reopenOrigin.reopenInTunnel},
        openFolder: {execute: openFolder},
        configureContainerFeatures: {
          execute: async () => {
            await configureFeatures();
          },
        },
        createDevContainerFile: {
          execute: createDevContainerFile({
            ...continuation,
            window: {
              folders: windowFolders,
              remoteName: () => vscode.env.remoteName,
              workspaceFile: () => vscode.workspace.workspaceFile,
            },
            showModal: (message, buttons) =>
              vscode.window.showInformationMessage(
                '',
                {modal: true, detail: message},
                ...buttons,
              ),
            openFolder: () =>
              vscode.commands.executeCommand(
                'workbench.action.files.openFolder',
              ),
            translate,
          }),
        },
        settings: {
          execute: openOwnSettings(
            (command, ...parameters) =>
              vscode.commands.executeCommand(command, ...parameters),
            context.extension.id,
          ),
        },
        openInformationAboutMountPerformance: {
          execute: async () => {
            await vscode.env.openExternal(
              vscode.Uri.parse(MOUNT_PERFORMANCE_PAGE),
            );
          },
        },
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
        startContainer: {execute: argument => rowActions?.start(argument)},
        stopContainer: {execute: argument => rowActions?.stop(argument)},
        removeContainer: {execute: argument => rowActions?.remove(argument)},
        showDetails: {
          execute: async argument => {
            const target = containerRowOf(argument);
            if (target !== undefined) {
              await detailsView?.showContainer(target.id, target.label);
            }
          },
        },
        inspectDockerResource: {execute: argument => inspectRow?.(argument)},
        showContainerLog: {execute: argument => showContainerLog?.(argument)},
        openFolderInContainerInCurrentWindow: {
          execute: argument => rowOpen.current(argument),
        },
        openFolderInContainerInNewWindow: {
          execute: argument => rowOpen.inNewWindow(argument),
        },
        openRepositoryInUniqueVolume: cloneCommand(),
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
      openLog: file =>
        vscode.window.showTextDocument(vscode.Uri.file(file), {
          preview: true,
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
        }),
      exists: file =>
        Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.file(file))).then(
          () => true,
          () => false,
        ),
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
    const shutdownHelper = nodeClientEnvironment(
      process.execPath,
      SHUTDOWN_CLIENT_WAITS,
      process.platform,
    );
    const connector = containerConnectorOf({
      shutdown: createWindowLease({
        acquire: () =>
          acquire(
            shutdownHelper,
            shutdownHelperRequest(
              {
                extensionFolder: context.extensionUri.fsPath,
                storageFolder: context.globalStorageUri.fsPath,
              },
              new AbortController().signal,
            ),
          ),
        logger,
      }),
      newConnectionId: randomUUID,
      engineFor: nodeEngineHost,
      cliFor: environment => bridgeFor(environment, logger),
      volumes: {
        bootstrapSettings: () => {
          const configuration = vscode.workspace.getConfiguration();
          return bootstrapSettingsOf({
            image: configuration.get(settings.bootstrapImage.id),
            pull: configuration.get(settings.bootstrapImagePull.id),
            socketPath: configuration.get(settings.dockerSocketPath.id),
          });
        },
        buildContext: () => {
          const cliFiles = cliPathsOf(
            context.extensionPath,
            vscode.env.appRoot,
          );
          return writeBuildContext(
            {
              dockerfile: path.join(
                context.extensionPath,
                'resources',
                'volume-bootstrap',
                'Dockerfile',
              ),
              cliFolder: path.dirname(cliFiles.entry),
              preload: cliFiles.preload,
            },
            os.tmpdir(),
          );
        },
        typed: payload =>
          typedSourceRecorded(context.globalState, payload, Date.now()),
        clearTyped: payload =>
          clearTypedSource(context.globalState, payload, Date.now()),
        bootstrapBridge: (bootstrap, workspace, environment, engine) => {
          const steps = {
            engine: engine.host,
            options: {cancellation: new AbortController().signal},
          };
          return cliBridgeOf(
            containerCliHost(
              engine.dockerPath,
              bootstrap,
              environment,
              systemCliPorts,
            ),
            bootstrapFilesOf(steps, bootstrap),
            bootstrapOverrideStoreOf(steps, bootstrap),
            environment,
            logger,
            volumeRewriteOf(environment, workspace, logger),
          );
        },
        hostBridge: (configText, workspace, environment) =>
          bridgeFor(environment, logger, {
            configText,
            rewrite: volumeRewriteOf(environment, workspace, logger),
          }),
        standIn: async () => {
          const folder = await mkdtemp(
            path.join(os.tmpdir(), 'remote-containers-stand-in-'),
          );
          return {
            folder,
            dispose: () => rm(folder, {recursive: true, force: true}),
          };
        },
        showShallow: repository => {
          void vscode.window.showWarningMessage(
            ownText('historyNotFetched', [repository], translate),
          );
        },
      },
      lifecycleFor: (engine, bridge, presenter, backgroundStage) =>
        containerLifecycleOf({
          engine,
          // eslint-disable-next-line id-length -- the lifecycle's dependency is named cli
          cli: bridge,
          logger,
          presenter,
          clock: Date.now,
          userDataFolder: path.join(context.globalStorageUri.fsPath, 'data'),
          ...(backgroundStage === undefined
            ? {
                compose: composeResolverOf({
                  route: (base, cancellation) =>
                    composeRouteOf(
                      {
                        docker: engine,
                        engineFor: nodeEngineHost,
                        composePath: () =>
                          vscode.workspace
                            .getConfiguration()
                            .get(settings.dockerComposePath.id),
                        base: engineBaseOf({
                          folder: base,
                          trusted: vscode.workspace.isTrusted,
                        }),
                        logger: logger.child('compose'),
                      },
                      cancellation,
                    ),
                  runVia: (route, argv, options) =>
                    route.kind === 'plugin'
                      ? engine.run(
                          ['compose', ...argv],
                          {kind: 'none'},
                          options,
                        )
                      : nodeEngineHost(route.file).run(
                          argv,
                          {kind: 'none'},
                          options,
                        ),
                  readText: file => readFile(file, 'utf8'),
                  environment: process.env,
                  logger: logger.child('compose'),
                }),
              }
            : {backgroundStage}),
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
          defaultFeatures: configuration.inspect(settings.defaultFeatures.id)
            ?.globalValue,
          lockfile: configuration.inspect(settings.lockfile.id)?.globalValue,
          defaultExtensions: configuration.inspect(
            settings.defaultExtensions.id,
          )?.globalValue,
          deprecatedDefaultExtensions: configuration.inspect(
            settings.defaultExtensions.legacyId,
          )?.globalValue,
        };
      },
      discoverConfigurations: folder =>
        discoverConfigurations(folder, configFiles, collate),
      noEngineProgram: noEngineProgramOf(context.globalStorageUri.fsPath),
      clientPlatform: process.platform,
      pathExists: async place => {
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(place));
          return true;
        } catch {
          return false;
        }
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
      beginAttempt: () => {
        attemptLog.begin();
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
            // The editor's fetch, so that its proxy settings apply as for the server's download.
            queryGallery: async (address, query, cancellation) => {
              try {
                const response = await fetch(address, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json;api-version=3.0-preview.1',
                  },
                  body: JSON.stringify(query),
                  signal: cancellation,
                });
                return response.ok ? await response.json() : undefined;
              } catch {
                return undefined;
              }
            },
            readText: async file => {
              try {
                return await readFile(file, 'utf8');
              } catch {
                return undefined;
              }
            },
            logger,
            translate,
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
    windowShutdown.leave = () => connector.leaveShutdown();
    // `env.remoteAuthority` belongs to the resolvers proposal: reading it without the grant throws.
    const windowOrigin = served.missing.includes('resolvers')
      ? undefined
      : windowOriginOf(vscode.env.remoteAuthority, process.platform);
    connector.announceShutdown(
      served.missing.includes('resolvers')
        ? undefined
        : vscode.env.remoteAuthority,
    );
    void vscode.commands.executeCommand(
      'setContext',
      contextKeys.canReopenLocally.id,
      windowOrigin?.kind === 'local',
    );
    if (served.missing.length === 0) {
      offerReopenFor(logger).catch((caught: unknown) => {
        logger.error(
          `the reopen notification failed: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      });
    }
    const registered = await registerContainerResolver(
      {
        resolverEditor: resolverEditorOf(vscode, RESOLVER_EDITOR_OPTIONS),
        labels: vscode.workspace,
        portsView: {
          enablePortsView: () =>
            vscode.commands.executeCommand('setContext', PORTS_VIEW_KEY, true),
        },
        commands: host,
        recentLabel: recentLabelPortsOf(vscode, () => os.homedir()),
        knownNames: context.globalState,
        presenter: recoveryPortsOf(vscode, {
          writeAttemptLog: async () =>
            writeAttemptLog(attemptLog, context.logUri.fsPath, Date.now()),
          fileExists: file =>
            Promise.resolve(
              vscode.workspace.fs.stat(
                vscode.Uri.from({scheme: file.scheme, path: file.path}),
              ),
            ).then(
              () => true,
              () => false,
            ),
          keepEdit: (folder, configFile, logFile) =>
            storePendingEdit(
              context.globalState,
              folder,
              configFile,
              Date.now(),
              logFile,
            ),
          storePausedRetry: containerId =>
            storePausedRetry(context.globalState, containerId, Date.now()),
          rebuildContainer: () =>
            vscode.commands.executeCommand(commands.rebuildContainer.id),
          logger,
        }),
        translate,
        forwarder: forwarderOf({
          // openTunnel is a proposed API ('tunnels'); the types of the proposal are not part of this project.
          tunnels: vscode.workspace as unknown as TunnelHost,
          showError: text => vscode.window.showErrorMessage(text),
          logger,
          translate,
        }),
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
    const configWatch =
      registered.registration === 'registered'
        ? configWatchOf({
            readFile: file =>
              readFile(file).then(
                bytes => new Uint8Array(bytes),
                () => undefined,
              ),
            watchFolder: (folder, listener, failed) => {
              try {
                const watcher = watch(folder, (kind, name) => {
                  listener(name ?? undefined);
                });
                watcher.on('error', () => {
                  watcher.close();
                  failed();
                });
                return {
                  dispose: () => {
                    watcher.close();
                  },
                };
              } catch {
                return undefined;
              }
            },
            setTimer: (callback, milliseconds) => {
              const timer = setTimeout(callback, milliseconds);
              return () => {
                clearTimeout(timer);
              };
            },
            state: context.workspaceState,
            show: (message, buttons) =>
              vscode.window.showInformationMessage(message, ...buttons),
            rebuild: () =>
              vscode.commands.executeCommand(commands.rebuildContainer.id),
            translate,
            logger,
          })
        : undefined;
    if (configWatch !== undefined) {
      const stopListening = connector.onHeldChanged(() => {
        const held = connector.heldConnection();
        if (held === undefined) {
          configWatch.pause();
          return;
        }
        configWatch.activate(held).catch((caught: unknown) => {
          logger.warn(
            `the configuration watch failed: ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        });
      });
      context.subscriptions.push(
        {dispose: stopListening},
        {
          dispose: () => {
            configWatch.dispose();
          },
        },
      );
    }
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
      trusted: () => vscode.workspace.isTrusted,
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
    const engineWatch = engineWatchOf({
      configFolder: () =>
        process.env.DOCKER_CONFIG ?? path.join(os.homedir(), '.docker'),
      watchFolder: (folder, recursive, listener) => {
        try {
          const watcher = watch(folder, {recursive}, (kind, name) => {
            listener(name ?? undefined);
          });
          watcher.on('error', () => {
            watcher.close();
          });
          return {
            dispose: () => {
              watcher.close();
            },
          };
        } catch {
          return undefined;
        }
      },
      signature: file =>
        stat(file).then(
          found => `${String(found.size)}:${String(found.mtimeMs)}`,
          () => 'missing',
        ),
      engineKey: () =>
        effectiveEngineKey(
          engineSources(),
          served.preflight,
          {
            folder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            trusted: vscode.workspace.isTrusted,
          },
          new AbortController().signal,
        ),
      setTimer: (milliseconds, callback) =>
        served.preflight.setTimer(milliseconds, callback),
      logger,
    });
    targetsView = showTargetsWhenRegistered({
      editor: explorerEditor,
      loaded: () => {
        result.registerDeferred();
      },
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
      onEngineChange: listener => engineWatch.onEngineChange(listener),
      onDockerPathChange: listener =>
        vscode.workspace.onDidChangeConfiguration(event => {
          if (event.affectsConfiguration(settings.dockerPath.id)) {
            listener();
          }
        }),
      onTrustGranted: listener =>
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
          listener();
        }),
      translate,
      logger,
    });
    const rowActionsStop = new AbortController();
    rowActions = rowActionsOf({
      engine: () => engineOfWindow(windowEngine, connector.heldConnection()),
      program: () => executableOf(windowEngine.dockerPath(), undefined).written,
      confirm: async ({message, detail, accept}) =>
        (await vscode.window.showWarningMessage(
          message,
          {modal: true, detail},
          accept,
        )) === accept,
      showError: text => {
        void vscode.window.showErrorMessage(text);
      },
      refresh: async () => {
        await targetsView?.refresh();
      },
      translate,
      cancellation: rowActionsStop.signal,
    });
    inspectRow = inspectOf({
      engine: () => engineOfWindow(windowEngine, connector.heldConnection()),
      program: () => executableOf(windowEngine.dockerPath(), undefined).written,
      open: async content => {
        const document = await vscode.workspace.openTextDocument({
          language: 'json',
          content,
        });
        return vscode.window.showTextDocument(document);
      },
      showError: text => {
        void vscode.window.showErrorMessage(text);
      },
      translate,
      cancellation: rowActionsStop.signal,
    });
    showContainerLog = containerLogOf({
      engine: () => engineOfWindow(windowEngine, connector.heldConnection()),
      engineFile: () => {
        const executable = executableOf(windowEngine.dockerPath(), undefined);
        return executable.kind === 'spawn'
          ? executable.file
          : executable.written;
      },
      createTerminal: options => vscode.window.createTerminal(options),
      cancellation: rowActionsStop.signal,
    });
    detailsView = showDetailsWhenRegistered({
      mountPerformanceHint: () =>
        mountPerformanceHintApplies({
          platform: process.platform,
          executeInWSL:
            vscode.workspace
              .getConfiguration('dev.containers')
              .get('executeInWSL') === true,
          remoteName: vscode.env.remoteName,
        }),
      editor: {
        ...explorerEditor,
        focus: () =>
          vscode.commands.executeCommand(`${views.detailsContainers}.focus`),
      },
      held: () => connector.heldConnection(),
      engine: () => engineOfWindow(windowEngine, connector.heldConnection()),
      onHeldChanged: listener => connector.onHeldChanged(listener),
      events: containerEvents,
      setTimer: (milliseconds, callback) =>
        served.preflight.setTimer(milliseconds, callback),
      translate,
      logger,
    });
    if (vscode.env.remoteName === undefined) {
      context.subscriptions.push(
        featureDiagnosticsProviderOf(featureDiagnosticsHost(), translate),
      );
    }
    context.subscriptions.push(
      {
        dispose: () => {
          rowActionsStop.abort();
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
