/**
 * @fileoverview The Remote - SSH extension's entry point: it loads the editor, which exists only in the
 * extension host, so the unit tests do not load it. Activation runs the stand-down guard and, when this extension
 * serves, opens the log, registers the commands the package serves, and registers the connect over the editor and
 * this machine.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  familySetupPortsOf,
  PORTS_VIEW_KEY,
  type ResolverEditor,
  resolverEditorOf,
} from 'lib-authority';
import {
  commandBus,
  createProtocol,
  EXPLORER_INBOX,
  systemTimers,
} from 'lib-companion';
import {identifierHost} from 'lib-identifiers';
import {listHosts} from 'lib-ssh';
import type {Logger} from 'lib-log';
import {type ProductProfile, profileOf} from 'lib-product';
import {standDownHost} from 'lib-standdown';
import {activateRemoteSsh} from './activation.ts';
import {
  configFileEditorOf,
  nodeConfigFiles,
  nodeHostFiles,
} from './config/config-file-editor.ts';
import {
  type ConfigFilePlaces,
  CONFIG_FILE_HELP_ADDRESS,
  openConfigFileHandler,
} from './config/open-config-file.ts';
import {
  connectCommandEditorOf,
  hostPickPortOf,
  openerHostOf,
} from './connect/connect-editor.ts';
import {
  mismatchLine,
  serveSliceEndpoints,
} from './companion/slice-endpoints.ts';
import {pushActiveFolders} from './companion/active-folders.ts';
import {serveHistoryEndpoints} from './companion/history-endpoints.ts';
import {signalHostsChanged} from './companion/hosts-changed.ts';
import {
  recordOnFirstResolve,
  type WindowWorkspace,
} from './companion/history-recorder.ts';
import {nodeConfigReader} from './connect/node-config-reader.ts';
import {connectAssemblyOf} from './connect-ports.ts';
import {editorOperationsOf} from './editor-operations.ts';
import {type EditorAdapters, editorSurfacesOf} from './editor-surfaces.ts';
import {
  type HelpEditor,
  type HelpHandlers,
  helpHandlers,
  helpLinksOf,
} from './help-commands.ts';
import {
  commands,
  enabledApiProposals,
  runtimeCommands,
  settings,
  standDown,
} from './identifiers.generated.ts';
import {clientPlatformOf, nodeFacts, nodeMachineOf} from './node-machine.ts';
import {textOf} from './pipeline/connect-settings.ts';
import {type ConnectRegistration, registerConnect} from './register-connect.ts';
import {
  downloadProgressOf,
  failureDialogOf,
  filePickPortOf,
  licenceDialogOf,
  preconnectDialogPortOf,
  mitigationPickPortOf,
  noticeOf,
  platformPickPortOf,
  promptEditorOf,
  textInputOf,
} from './surfaces/editor-adapters.ts';
import {
  adaptersFor,
  authorityReportingResolverEditorOf,
  channelPortFor,
  progressFor,
  windowNameFor,
} from './surfaces/scripted-adapters.ts';
import {loginTerminalsOf} from './surfaces/login-terminal.ts';
import {
  linkTerminalsOf,
  terminalEnvironmentOf,
} from './surfaces/window-forwarding.ts';

/** The file the system-wide SSH configuration lives in. */
const SYSTEM_CONFIG_FILE = '/etc/ssh/ssh_config';

/** The stand-down warning and its button, as written in the runtime strings. */
const STAND_DOWN_WARNING =
  'Remote - SSH stays inactive in this window because another extension that provides SSH remotes is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';
const STAND_DOWN_BUTTON = 'Show Other Extension';

/** The English templates of the proposed-API setup notices; the placeholders are filled by the setup. */
const SETUP_TEXT_TEMPLATES = {
  setup:
    "{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.",
  failedAttempt:
    "The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-ssh', then restart {1}.",
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
  contributes?: {
    commands?: Array<{command: string; title: string}>;
    remoteHelp?: Record<string, unknown>;
  };
}

/** The editor's product, as its `product.json` describes it. */
async function editorProfile(): Promise<ProductProfile> {
  return profileOf(
    await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'),
  );
}

/** The `dataFolderName` of the editor's product, which names the folder of its runtime arguments. */
async function dataFolderNameOfEditor(): Promise<string> {
  return (await editorProfile()).dataFolderName;
}

/** The files the harness's adapters read and append to: the script, the record and the log. */
const ACCEPTANCE_FILES = {
  read: (file: string): string => readFileSync(file, 'utf8'),
  append: (file: string, text: string): void => {
    appendFileSync(file, text);
  },
};

/**
 * The name of this window for the harness's script and record: what the window's agent claimed, from the pid file
 * the launch's windows variable points to; without the variable, the window's folder name as before.
 */
async function acceptanceWindowName(): Promise<string> {
  return windowNameFor(
    process.env,
    process.pid,
    vscode.workspace.workspaceFolders?.[0]?.uri.path,
    {
      read: file => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    },
    milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    Date.now,
  );
}

/** Writes the window's authority beside the pid file, where the window's agent reads it. */
function recordAuthority(file: string, authority: string): void {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, authority);
}

/**
 * The resolver's editor the harness uses: its progress recorded when the switch is on, and every authority the
 * resolver resolves written beside the pid file, so the window's agent reports it. The same editor otherwise.
 */
function acceptanceResolverEditorOf(
  editor: ResolverEditor,
  windowName: string,
): ResolverEditor {
  const progress = progressFor(
    process.env,
    editor.progress,
    ACCEPTANCE_FILES,
    windowName,
  );
  return {
    ...authorityReportingResolverEditorOf(
      process.env,
      process.pid,
      editor,
      recordAuthority,
    ),
    progress,
  };
}

/** Called by the editor when it resolves an `ssh-remote` authority, runs one of the commands, or opens a URI. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  const host = identifierHost(vscode, manifest);
  // Made once, before the setup: the script is read once per window, and the setup's notices go through the same notice port.
  const adapters = await surfaceAdapters();
  const extension = {
    id: context.extension.id,
    pack: manifest.extensionPack ?? [],
    name: manifest.name,
    version: manifest.version,
  };
  const configPlaces: ConfigFilePlaces = {
    homeFolder: homedir(),
    platform: clientPlatformOf(process.platform),
    userFile: path.join(homedir(), '.ssh', 'config'),
    systemFile: SYSTEM_CONFIG_FILE,
  };
  const help: HelpEditor = {
    openExternal: address => vscode.env.openExternal(vscode.Uri.parse(address)),
    openSettings: filter =>
      vscode.commands.executeCommand('workbench.action.openSettings', filter),
    openIssueReporter: extensionId =>
      vscode.commands.executeCommand('workbench.action.openIssueReporter', {
        extensionId,
      }),
  };
  // The commands that signal a change of the hosts are made before the protocol is; the signal is bound once it is.
  const hostsSignal = {send: (): void => undefined};
  function hostsChanged(): void {
    hostsSignal.send();
  }
  const result = await activateRemoteSsh({
    table: {commands, settings, standDown},
    extension,
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
    help,
    openConfigFile: openConfigFileHandler(
      configFileEditorOf(vscode, adapters.filePick),
      nodeConfigFiles,
      {
        openSettings: filter => help.openSettings(filter),
        openHelp: () => help.openExternal(CONFIG_FILE_HELP_ADDRESS),
      },
      configPlaces,
      () => textOf(host, 'configFile'),
      extension,
      translate,
      hostsChanged,
    ),
    channels: channelPortFor(process.env, vscode.window, ACCEPTANCE_FILES),
    clock: Date.now,
    gate: logFailure =>
      familySetupPortsOf(vscode, context, {
        displayName: manifest.displayName,
        proposals: enabledApiProposals,
        viewIds: [],
        templates: SETUP_TEXT_TEMPLATES,
        translate,
        dataFolderName: dataFolderNameOfEditor,
        logFailure,
        notices: adapters.notice,
      }),
  });
  if (result.kind !== 'serving') {
    return;
  }
  context.subscriptions.push({
    dispose: () => {
      result.dispose();
    },
  });
  const connect = await registerConnectOf(
    context,
    manifest,
    host,
    {
      revealLog: () => {
        result.revealLog();
      },
      logger: result.logger,
      help: helpHandlers(help, helpLinksOf(manifest), extension),
      resolversGranted: result.proposals.granted.includes('resolvers'),
      configPlaces,
      hostsChanged,
    },
    adapters,
  );
  context.subscriptions.push({
    dispose: () => {
      connect.dispose();
    },
  });
  const companion = createProtocol({
    // eslint-disable-next-line id-length -- the protocol's option is named bus
    bus: commandBus(vscode),
    timers: systemTimers,
    onVersionMismatch: mismatch => {
      result.logger.warn(mismatchLine(mismatch));
    },
  });
  hostsSignal.send = () => {
    signalHostsChanged(companion);
  };
  const history = serveHistoryEndpoints(companion, context.globalState);
  const firstResolve = {
    onFirstResolveSettled: (listener: () => void) => {
      connect.onFirstResolveSettled(listener);
    },
    lastResolve: () => connect.activeConnection()?.lastResolve ?? 'none',
  } as const;
  recordOnFirstResolve(firstResolve, workspaceOf(vscode), context.globalState);
  pushActiveFolders({
    hasWorkspace: () =>
      vscode.workspace.workspaceFile !== undefined ||
      (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
    remoteAuthority: () => vscode.env.remoteAuthority,
    resolve: firstResolve,
    send: push => {
      companion.fireAndForget(EXPLORER_INBOX.setActiveFolders.commandId, push);
    },
  });
  const endpoints = serveSliceEndpoints(companion, {
    listHosts: () => configuredHosts(host),
    hostSource: () => textOf(host, 'configFile'),
    activeConnection: () => connect.activeConnection(),
    opener: openerHostOf(vscode),
    logger: result.logger,
    resolversGranted: result.proposals.granted.includes('resolvers'),
  });
  context.subscriptions.push({
    dispose: () => {
      endpoints.dispose();
      history.dispose();
    },
  });
}

/** What the history recorder reads of the window: its workspace file and its folders. */
function workspaceOf(editor: typeof vscode): WindowWorkspace {
  return {
    workspaceFile: () => editor.workspace.workspaceFile,
    workspaceFolders: () =>
      (editor.workspace.workspaceFolders ?? []).map(folder => folder.uri),
  };
}

/** The hosts of the files in effect, read at each call: the host pick's and the companion commands' one reading. */
function configuredHosts(host: ReturnType<typeof identifierHost>) {
  return listHosts(
    textOf(host, 'configFile'),
    {
      homeFolder: homedir(),
      platform: clientPlatformOf(process.platform),
      ...(process.env.ProgramData === undefined
        ? {}
        : {programDataFolder: process.env.ProgramData}),
    },
    nodeConfigReader,
  );
}

/** A template in the display language. */
function translate(template: string): string {
  return vscode.l10n.t(template);
}

/** The adapters of the editor's surfaces: the real ones, or the harness's scripted ones when its switch is on. */
async function surfaceAdapters(): Promise<EditorAdapters> {
  const windowName = await acceptanceWindowName();
  return adaptersFor(
    process.env,
    {
      prompts: promptEditorOf(vscode, translate),
      terminals: loginTerminalsOf(vscode, homedir()),
      linkTerminals: linkTerminalsOf(vscode),
      failureDialog: failureDialogOf(vscode),
      licenceDialog: licenceDialogOf(vscode),
      preconnectDialog: preconnectDialogPortOf(vscode),
      platformPick: platformPickPortOf(vscode, translate),
      mitigationPick: mitigationPickPortOf(vscode),
      downloadProgress: downloadProgressOf(vscode),
      textInput: textInputOf(vscode),
      notice: noticeOf(vscode),
      hostPick: hostPickPortOf(vscode, translate),
      filePick: filePickPortOf(vscode, translate),
    },
    ACCEPTANCE_FILES,
    windowName,
  );
}

/** What the connect takes from the activation that served. */
interface ServedActivation {
  revealLog(): void;
  logger: Logger;
  help: HelpHandlers;
  resolversGranted: boolean;
  /** The client's configuration files, which the command that adds a host writes to. */
  configPlaces: ConfigFilePlaces;
  /** Tells Remote Explorer that the configured hosts may have changed. */
  hostsChanged: () => void;
}

/** The connect over the editor and this machine: its surfaces, its assembly and its registration. */
async function registerConnectOf(
  context: vscode.ExtensionContext,
  manifest: Manifest,
  host: ReturnType<typeof identifierHost>,
  served: ServedActivation,
  adapters: EditorAdapters,
): Promise<ConnectRegistration> {
  const window = {alias: (): string => ''};
  const windowName = await acceptanceWindowName();
  const surfaces = editorSurfacesOf(
    adapters,
    editorOperationsOf(vscode, () => {
      served.revealLog();
    }),
    {
      settings: host,
      configuredHosts: () => configuredHosts(host),
      translate,
      help: served.help,
      names: {
        alias: () => window.alias(),
        applicationName: (await editorProfile()).applicationName,
        displayName: manifest.displayName,
      },
      acceptanceState: context.globalState,
      noticeState: context.globalState,
      logger: served.logger,
      applyTerminalEnvironment: terminalEnvironmentOf(
        context.environmentVariableCollection,
      ),
      // The tunnel service is a proposed API the manifest enables; a window without it logs the failure of each forward.
      tunnels: vscode.workspace,
    },
  );
  const machine = nodeMachineOf(
    {
      extensionFolder: context.extensionPath,
      storageFolder: context.globalStorageUri.fsPath,
      runtime: process.execPath,
      profile: await editorProfile(),
      httpGet: (address, init) => fetch(address, init),
    },
    nodeFacts(),
  );
  const registration = await registerConnect(
    {
      resolverEditor: acceptanceResolverEditorOf(
        resolverEditorOf(vscode, {
          detailsCommand: runtimeCommands.showDetails,
          candidatePortSource: 'output',
        }),
        windowName,
      ),
      labels: vscode.workspace,
      portsView: {
        enablePortsView: () =>
          vscode.commands.executeCommand('setContext', PORTS_VIEW_KEY, true),
      },
      commands: host,
      connectEditor: connectCommandEditorOf(
        vscode,
        () => configuredHosts(host),
        adapters.hostPick,
      ),
      openExternal: address =>
        vscode.env.openExternal(vscode.Uri.parse(address)),
      translate,
      globalState: context.globalState,
      logger: served.logger,
      notice: adapters.notice,
      addHost: {
        editor: configFileEditorOf(vscode, adapters.filePick),
        input: adapters.textInput,
        files: nodeHostFiles,
        places: served.configPlaces,
        configFile: () => textOf(host, 'configFile'),
        hostsChanged: served.hostsChanged,
      },
    },
    connectAssemblyOf(surfaces, machine, served.logger),
    served.resolversGranted,
  );
  window.alias = () => registration.currentAlias();
  return registration;
}
