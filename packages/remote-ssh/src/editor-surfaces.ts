/**
 * @fileoverview The surfaces a connect shows, assembled from the editor's adapters and its operations: the failure
 * dialog with its actions and "More Actions...", the licence modal, the platform pick and its write, and the
 * acceptances. Nothing here imports the editor; the extension passes the adapters and the operations.
 */

import type {TunnelOpener} from './forwarding/default-forwards.ts';
import type {AcceptanceStore} from 'lib-server';
import type {FilePickPort} from './config/file-choice.ts';
import type {DownloadProgressPort} from './cli/server-download-progress.ts';
import type {HostPickPort} from './surfaces/host-pick.ts';
import type {LoginTerminals} from 'lib-ssh';
import type {LinkTerminals} from './pipeline/forwarding-step.ts';
import {
  pickRemotePlatform,
  type PlatformPickPort,
} from './connect/platform-picker.ts';
import type {ConnectSurfaces} from './connect-ports.ts';
import type {HelpHandlers} from './help-commands.ts';
import type {RemotePlatform} from './pipeline/platform.ts';
import {
  acceptanceStoreOf,
  type AcceptanceState,
} from './surfaces/acceptance-store.ts';
import {
  type FailureDialogPort,
  failurePresenterOf,
  type PresenterNames,
} from './surfaces/failure-presenter.ts';
import {
  type LicenceDialogPort,
  licenceModalOf,
} from './surfaces/licence-modal.ts';
import {
  type MitigationPickPort,
  moreActionsOf,
} from './surfaces/mitigation-picker.ts';
import type {Logger} from 'lib-log';
import type {NoticePort} from './surfaces/notice.ts';
import {ownText} from './surfaces/own-strings.ts';
import type {PromptEditor} from './surfaces/prompt-surface.ts';
import type {TextInputPort} from './surfaces/text-input.ts';
import type {Translate} from './surfaces/strings.ts';
import type {SettingHost} from 'lib-identifiers';

/** The editor's adapters of the connect's surfaces. */
export interface EditorAdapters {
  prompts: PromptEditor;
  terminals: LoginTerminals;
  /** The terminals that make the agent link, real also under the harness: the editor's checks come before them. */
  linkTerminals: LinkTerminals;
  failureDialog: FailureDialogPort;
  licenceDialog: LicenceDialogPort;
  platformPick: PlatformPickPort;
  mitigationPick: MitigationPickPort;
  downloadProgress: DownloadProgressPort;
  /** A plain text input the commands ask. */
  textInput: TextInputPort;
  /** The non-modal notices the commands show. */
  notice: NoticePort;
  /** The host pick the connect commands show when they ask for a host. */
  hostPick: HostPickPort;
  /** The SSH configuration file pick the Open SSH Configuration File command shows. */
  filePick: FilePickPort;
}

/** The editor's operations the surfaces' buttons and items run. */
export interface EditorOperations {
  reloadWindow(): PromiseLike<unknown>;
  closeRemote(): PromiseLike<unknown>;
  openRecent(): PromiseLike<unknown>;
  /** Runs `opensshremotes.openConfigFile`. */
  openConfigFile(): PromiseLike<unknown>;
  /** Opens the Settings editor on one setting. */
  openSetting(settingId: string): PromiseLike<unknown>;
  /** Writes `value` to the user's settings of `settingId`. */
  writeUserSetting(settingId: string, value: unknown): PromiseLike<void>;
  /** Reveals the connection's log. */
  revealLog(): void;
}

/** What the surfaces need besides the adapters and the operations. */
export interface SurfaceContext {
  settings: SettingHost;
  translate: Translate;
  /** The help commands' handlers: "Open Documentation" and "Open Settings" run the same. */
  help: Pick<HelpHandlers, 'getHelp' | 'settings'>;
  /** The names the dialog and the modal show. */
  names: PresenterNames;
  /** The profile's own record of accepted terms, never synced. */
  acceptanceState: AcceptanceState;
  /** The profile's record of the notices the user asked not to see again. */
  noticeState: AcceptanceState;
  /** The window's log, where a notice that could not be shown is noted. */
  logger: Logger;
  /** Makes these the only variables the window's terminals get from the extension. */
  applyTerminalEnvironment: (
    variables: Readonly<Record<string, string>>,
  ) => void;
  /** The editor's tunnel service, which the default forwarded ports are opened through. */
  tunnels: TunnelOpener;
}

/** The setting the platform is written to. */
const REMOTE_PLATFORM_SETTING = 'remote.SSH.remotePlatform';

/** The user's `remote.SSH.remotePlatform` map, or an empty one when it holds no map. */
function platformMapOf(settings: SettingHost): Record<string, unknown> {
  const written = settings.inspectSetting(REMOTE_PLATFORM_SETTING).globalValue;
  return typeof written === 'object' &&
    written !== null &&
    !Array.isArray(written)
    ? {...(written as Record<string, unknown>)}
    : {};
}

/** The surfaces of every connect, over the editor's adapters and operations. */
export function editorSurfacesOf(
  adapters: EditorAdapters,
  operations: EditorOperations,
  context: SurfaceContext,
): ConnectSurfaces {
  const {translate} = context;
  const moreActions = moreActionsOf(
    adapters.mitigationPick,
    {
      reloadWindow: () => operations.reloadWindow(),
      openRecent: () => operations.openRecent(),
      openDocumentation: () => Promise.resolve(context.help.getHelp.execute()),
      openConfigFile: () => operations.openConfigFile(),
      openSettings: () => Promise.resolve(context.help.settings.execute()),
    },
    translate,
  );
  const acceptances: AcceptanceStore = acceptanceStoreOf(
    context.acceptanceState,
  );
  return {
    settings: context.settings,
    translate,
    prompts: adapters.prompts,
    terminals: adapters.terminals,
    linkTerminals: adapters.linkTerminals,
    applyTerminalEnvironment: context.applyTerminalEnvironment,
    tunnels: context.tunnels,
    pickPlatform: async (alias, cancellation) => {
      const picked = await pickRemotePlatform(
        adapters.platformPick,
        alias,
        cancellation,
      );
      return picked === 'cancelled' ? undefined : picked;
    },
    writePlatform: async (alias: string, platform: RemotePlatform) => {
      await operations.writeUserSetting(REMOTE_PLATFORM_SETTING, {
        ...platformMapOf(context.settings),
        [alias]: platform,
      });
    },
    notice: adapters.notice,
    noticeState: context.noticeState,
    licenceModal: licenceModalOf(
      adapters.licenceDialog,
      translate,
      context.names,
    ),
    acceptances,
    presenter: failurePresenterOf(
      adapters.failureDialog,
      {
        reload: () => operations.reloadWindow(),
        closeRemote: () => operations.closeRemote(),
        moreActions: () => moreActions(),
        openSetting: settingId => operations.openSetting(settingId),
      },
      translate,
      context.names,
    ),
    downloadProgress: adapters.downloadProgress,
    revealLog: () => {
      operations.revealLog();
    },
    rejectBindHost: (alias, configured) => {
      adapters.notice
        .showError(
          ownText({id: 'S168', values: [alias, configured]}, translate),
          [],
        )
        .catch((error: unknown) => {
          context.logger.warn(
            `the invalid bind host notice could not be shown: ${String(error)}`,
          );
        });
    },
  };
}
