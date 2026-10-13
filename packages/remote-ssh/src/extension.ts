/**
 * @fileoverview The Remote - SSH extension's entry point: it loads the editor, which exists only in the
 * extension host, so the unit tests do not load it. Activation runs the stand-down guard and, when this extension
 * serves, opens the log, registers the commands the package serves, and registers the connect over the editor and
 * this machine.
 */

import {appendFileSync, readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  gateEditorOf,
  type ResolverEditor,
  resolverEditorOf,
  setupPortsOf,
} from 'lib-authority';
import {identifierHost} from 'lib-identifiers';
import {listHosts} from 'lib-ssh';
import type {Logger} from 'lib-log';
import {type ProductProfile, readProfile} from 'lib-product';
import {standDownHost} from 'lib-standdown';
import {activateRemoteSsh} from './activation.ts';
import {
  configFileEditorOf,
  nodeConfigFiles,
} from './config/config-file-editor.ts';
import {openConfigFileHandler} from './config/open-config-file.ts';
import {connectCommandEditorOf} from './connect/connect-editor.ts';
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
  licenceDialogOf,
  mitigationPickPortOf,
  noticeOf,
  platformPickPortOf,
  promptEditorOf,
  textInputOf,
} from './surfaces/editor-adapters.ts';
import {
  adaptersFor,
  channelPortFor,
  progressFor,
  windowNameOf,
} from './surfaces/scripted-adapters.ts';
import {loginTerminalsOf} from './surfaces/login-terminal.ts';

/** The page about SSH configuration files that the picker's Help row opens. */
const CONFIG_HELP_ADDRESS =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-ssh/ssh-config.md';

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
  const reading = readProfile(
    await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'),
  );
  if (reading.kind === 'unreadable') {
    throw new Error(`product.json cannot be read: ${reading.reason}`);
  }
  return reading.profile;
}

/** The `dataFolderName` of the editor's product, which names the folder of its runtime arguments. */
async function dataFolderNameOfEditor(): Promise<string> {
  return (await editorProfile()).dataFolderName;
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

/** The files the harness's adapters read and append to: the script, the record and the log. */
const ACCEPTANCE_FILES = {
  read: (file: string): string => readFileSync(file, 'utf8'),
  append: (file: string, text: string): void => {
    appendFileSync(file, text);
  },
};

/** The name of this window for the harness's script and record: its first workspace folder's last segment, or `local`. */
function acceptanceWindowName(): string {
  return windowNameOf(vscode.workspace.workspaceFolders?.[0]?.uri.path);
}

/** The resolver's editor with its progress recorded when the harness's switch is on; the same editor otherwise. */
function acceptanceProgressOf(editor: ResolverEditor): ResolverEditor {
  return {
    ...editor,
    progress: progressFor(
      process.env,
      editor.progress,
      ACCEPTANCE_FILES,
      acceptanceWindowName(),
    ),
  };
}

/** Called by the editor when it resolves an `ssh-remote` authority, runs one of the commands, or opens a URI. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  const host = identifierHost(vscode, manifest);
  // Made once, before the setup: the script is read once per window, and the setup's notices go through the same notice port.
  const adapters = surfaceAdapters();
  const extension = {
    id: context.extension.id,
    pack: manifest.extensionPack ?? [],
    name: manifest.name,
    version: manifest.version,
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
      configFileEditorOf(vscode, translate),
      nodeConfigFiles,
      {
        openSettings: filter => help.openSettings(filter),
        openHelp: () => help.openExternal(CONFIG_HELP_ADDRESS),
      },
      {
        homeFolder: homedir(),
        platform: clientPlatformOf(process.platform),
        userFile: path.join(homedir(), '.ssh', 'config'),
        systemFile: SYSTEM_CONFIG_FILE,
      },
      () => textOf(host, 'configFile'),
      extension,
      translate,
    ),
    channels: channelPortFor(process.env, vscode.window, ACCEPTANCE_FILES),
    clock: Date.now,
    gate: logFailure =>
      setupPortsOf(
        gateEditorOf(
          vscode,
          context,
          readArgvFile,
          logFailure,
          adapters.notice,
        ),
        {
          extensionId: context.extension.id,
          displayName: manifest.displayName,
          applicationName: vscode.env.appName,
          proposals: enabledApiProposals,
          argv: {
            portableFolder: process.env.VSCODE_PORTABLE,
            homeFolder: homedir(),
            dataFolderName: dataFolderNameOfEditor,
          },
          platform: process.platform,
          texts: {
            setup: vscode.l10n.t(SETUP_TEXT_TEMPLATES.setup),
            failedAttempt: vscode.l10n.t(SETUP_TEXT_TEMPLATES.failedAttempt),
            restart: vscode.l10n.t(SETUP_TEXT_TEMPLATES.restart),
            configureButton: vscode.l10n.t(
              SETUP_TEXT_TEMPLATES.configureButton,
            ),
            notNowButton: vscode.l10n.t(SETUP_TEXT_TEMPLATES.notNowButton),
            quitButton: vscode.l10n.t(SETUP_TEXT_TEMPLATES.quitButton),
          },
          logFailure,
        },
      ),
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
    },
    adapters,
  );
  context.subscriptions.push({
    dispose: () => {
      connect.dispose();
    },
  });
}

/** A template in the display language. */
function translate(template: string): string {
  return vscode.l10n.t(template);
}

/** The adapters of the editor's surfaces: the real ones, or the harness's scripted ones when its switch is on. */
function surfaceAdapters(): EditorAdapters {
  return adaptersFor(
    process.env,
    {
      prompts: promptEditorOf(vscode, translate),
      terminals: loginTerminalsOf(vscode, homedir()),
      failureDialog: failureDialogOf(vscode),
      licenceDialog: licenceDialogOf(vscode),
      platformPick: platformPickPortOf(vscode, translate),
      mitigationPick: mitigationPickPortOf(vscode),
      downloadProgress: downloadProgressOf(vscode),
      textInput: textInputOf(vscode),
      notice: noticeOf(vscode),
    },
    ACCEPTANCE_FILES,
    acceptanceWindowName(),
  );
}

/** What the connect takes from the activation that served. */
interface ServedActivation {
  revealLog(): void;
  logger: Logger;
  help: HelpHandlers;
  resolversGranted: boolean;
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
  const surfaces = editorSurfacesOf(
    adapters,
    editorOperationsOf(vscode, () => {
      served.revealLog();
    }),
    {
      settings: host,
      translate,
      help: served.help,
      names: {
        alias: () => window.alias(),
        applicationName: vscode.env.appName,
        displayName: manifest.displayName,
      },
      acceptanceState: context.globalState,
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
      resolverEditor: acceptanceProgressOf(
        resolverEditorOf(vscode, {
          detailsCommand: runtimeCommands.showDetails,
        }),
      ),
      labels: vscode.workspace,
      commands: host,
      connectEditor: connectCommandEditorOf(vscode, translate, () =>
        listHosts(
          textOf(host, 'configFile'),
          {
            homeFolder: homedir(),
            platform: clientPlatformOf(process.platform),
            ...(process.env.ProgramData === undefined
              ? {}
              : {programDataFolder: process.env.ProgramData}),
          },
          nodeConfigReader,
        ),
      ),
      openExternal: address =>
        vscode.env.openExternal(vscode.Uri.parse(address)),
      translate,
      globalState: context.globalState,
      logger: served.logger,
      notice: adapters.notice,
    },
    connectAssemblyOf(surfaces, machine, served.logger),
    served.resolversGranted,
  );
  window.alias = () => registration.currentAlias();
  return registration;
}
