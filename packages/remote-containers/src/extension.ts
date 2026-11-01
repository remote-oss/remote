/**
 * @fileoverview The entry of Dev Containers in the desktop editor: it hands the editor to the activation, with the
 * proposed-API setup and the strings of the notices.
 */

import {appendFileSync, readFileSync} from 'node:fs';
import {
  access,
  constants as fileConstants,
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
import {randomUUID} from 'node:crypto';
import * as vscode from 'vscode';
import {
  familySetupPortsOf,
  PORTS_VIEW_KEY,
  resolverEditorOf,
} from 'lib-authority';
import {nodeLocalPort, nodePortProber} from 'lib-forwarding';
import {acquire, nodeClientEnvironment, nodeTimer} from 'lib-helper';
import {identifierHost} from 'lib-identifiers';
import type {Logger, RevealableChannel} from 'lib-log';
import {profileOf} from 'lib-product';
import {downloadPortOf, nodeClientFiles, nodeCredentialsPort} from 'lib-server';
import {standDownHost} from 'lib-standdown';
import {containersChannelPortFor} from './acceptance-log.ts';
import {activateContainers} from './activation.ts';
import {serializedUriOf} from './authority/payload.ts';
import {manifestStoreOf} from './features/manifest-store.ts';
import {downloadTextOver} from './authoring/catalogue-download.ts';
import {
  addConfiguration,
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
import {containerConnectorOf} from './connect/connector.ts';
import {openHostRelay} from './connect/host-relay.ts';
import {recentLabelPortsOf} from './connect/recent-editor.ts';
import {
  registerContainerResolver,
  RESOLVER_EDITOR_OPTIONS,
} from './connect/register-connector.ts';
import {runServerSteps} from './connect/server-steps.ts';
import {executableOf} from './engine/executable.ts';
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
  /** Offers to reopen the window's folder in its container, over what the window holds now. */
  function offerReopenFor(
    logger: Logger,
    variant: NotificationVariant = 'folder',
  ): Promise<void> {
    return offerReopen(
      {
        window: {
          remote: vscode.env.remoteName !== undefined,
          workspaceFile: vscode.workspace.workspaceFile !== undefined,
          folders: windowFolders(),
        },
        global: context.globalState,
        workspace: context.workspaceState,
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
            shutdown: {leave: () => windowShutdown.leave()},
            logger: served.logger,
          },
          {buildNoCache},
        );
      }
      const bridge = bridgeFor(process.env, served.logger);
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
                kindOf: async file => {
                  const found = await stat(file).catch(() => undefined);
                  if (found === undefined) {
                    return 'missing';
                  }
                  return found.isDirectory() ? 'folder' : 'file';
                },
                read: file => readFile(file),
                write: (file, bytes) => writeFile(file, bytes),
                makeFolder: async folder => {
                  await mkdir(folder, {recursive: true});
                },
                removeFile: file => rm(file, {force: true}),
                removeFolder: folder =>
                  rm(folder, {recursive: true, force: true}),
                creationProblem: async folder => {
                  let nearest = folder;
                  while (!(await stat(nearest).catch(() => undefined))) {
                    nearest = path.dirname(nearest);
                  }
                  return access(nearest, fileConstants.W_OK).then(
                    () => undefined,
                    (caught: unknown) =>
                      caught instanceof Error ? caught.message : String(caught),
                  );
                },
              },
              dialogs: {
                show: modalShown,
                revealLog: () => {
                  logChannel?.show(true);
                },
              },
              hasUnsavedChanges: file =>
                vscode.workspace.textDocuments.some(
                  document => document.isDirty && document.uri.fsPath === file,
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
        files: {
          list: async folder =>
            (await readdir(folder, {withFileTypes: true}).catch(() => [])).map(
              entry => ({
                name: entry.name,
                kind: entry.isFile()
                  ? 'file'
                  : entry.isDirectory()
                    ? 'folder'
                    : 'other',
              }),
            ),
          read: file => readFile(file),
          write: (file, bytes) => writeFile(file, bytes),
        },
        stored: {
          files: {
            exists: file =>
              stat(file).then(
                () => true,
                () => false,
              ),
            read: file => readFile(file),
            write: (file, bytes) => writeFile(file, bytes),
            makeFolder: async folder => {
              await mkdir(folder, {recursive: true});
            },
            removeFolder: folder => rm(folder, {recursive: true, force: true}),
          },
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
      const authoring = {execute: wizardRunnerOf(wizardPorts)};
      const continuation = {
        wizard: authoring.execute,
        openPreview: (file: string) =>
          vscode.window.showTextDocument(vscode.Uri.file(file), {
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
          stored: folder => storedCandidate(storedLookup, folder),
          useTemplate: folder => addConfiguration(continuation, folder),
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
        bridge,
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
        createDevContainerFile: {
          execute: createDevContainerFile({
            ...continuation,
            window: {folders: windowFolders},
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
    windowShutdown.leave = () => connector.leaveShutdown();
    // `env.remoteAuthority` belongs to the resolvers proposal: reading it without the grant throws.
    connector.announceShutdown(
      served.missing.includes('resolvers')
        ? undefined
        : vscode.env.remoteAuthority,
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
        presenter: recoveryPortsOf(vscode, {
          writeAttemptLog: async () =>
            writeAttemptLog(attemptLog, context.logUri.fsPath, Date.now()),
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
