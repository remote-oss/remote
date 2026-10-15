/**
 * @fileoverview C8, the presenter of a connect that failed: the dialog with Retry, Edit Locally and More Actions..., and the
 * quick pick More Actions... opens. It waits for the user, so the resolve stays open while the dialog
 * shows. A window with no place to download the server from keeps its own two-button dialog.
 */

import type {Failed, FailurePresenter} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {DevContainerFolder} from '../authority/payload.ts';
import type {Translate} from './engine-dialogs.ts';
import {failureDialogOf, quickPickOf} from './failure-dialog.ts';
import {reasonText} from './failure-strings.ts';

/** The page "Open Documentation" opens: when the dev container can't be set up. */
export const CONTAINERS_DOCUMENTATION =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-containers/README.md#when-the-dev-container-cant-be-set-up';

/** The page "Learn More" opens when the container doesn't meet the server's requirements . */
export const CONTAINERS_REQUIREMENTS =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md#requirements';

/** The page the "learn more" of the reopen notification opens: the extension's introduction. */
export const CONTAINERS_INTRODUCTION =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md';

/** The labels of the buttons of the dialog for a window with no place to download the server from. */
const SERVER_SOURCE_BUTTONS = {
  openSetting: 'Open Setting',
  cancel: 'Cancel',
} as const;

/** The setting whose address a missing server source asks the user to set. */
const DOWNLOAD_SETTING = 'remote.serverDownloadBaseUrl';

/** What the presenter shows and opens. */
export interface RecoveryPorts {
  /** Shows the modal error; resolves with the chosen button's label, or undefined. */
  showError(
    message: string,
    detail: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  /** Shows the quick pick; resolves with the chosen label, or undefined. */
  pick(
    placeholder: string,
    labels: readonly string[],
  ): PromiseLike<string | undefined>;
  /** Keeps the configuration file for the window that opens `folder` next. */
  keepEdit(folder: string, configFile: string): PromiseLike<void>;
  /** Reopens the folder on this machine, in this window. */
  openLocally(folder: string): PromiseLike<unknown>;
  reloadWindow(): PromiseLike<unknown>;
  openRecent(): PromiseLike<unknown>;
  openExternal(address: string): PromiseLike<unknown>;
  openSetting(settingId: string): PromiseLike<unknown>;
  /** Runs `task` once the current call stack has unwound. */
  later(task: () => void): void;
  logger: Logger;
}

/** The presenter over `ports`; `target` is read each time something is shown. */
export function recoveryPresenterOf(
  ports: RecoveryPorts,
  target: () => DevContainerFolder | undefined,
  translate: Translate,
): FailurePresenter {
  /** Keeps the configuration file for the next window, then reopens the folder here; a failed keep is only logged. */
  async function editLocally(folder: DevContainerFolder): Promise<void> {
    try {
      await ports.keepEdit(
        folder.hostPath,
        folder.configFile.fsPath ?? folder.configFile.path,
      );
    } catch (caught) {
      ports.logger.warn(
        `the configuration file could not be kept for the next window: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
    await ports.openLocally(folder.hostPath);
  }

  /** The quick pick of More Actions...; Open Documentation shows it again. */
  async function showQuickPick(): Promise<void> {
    const folder = target();
    const pick = quickPickOf(folder, translate);
    const chosen = await ports.pick(
      pick.placeholder,
      pick.items.map(item => item.label),
    );
    const item = pick.items.find(each => each.label === chosen);
    if (item?.action === 'reload') {
      await ports.reloadWindow();
    } else if (item?.action === 'editLocally') {
      await editLocally(item.folder);
    } else if (item?.action === 'openRecent') {
      await ports.openRecent();
    } else if (item?.action === 'openDocumentation') {
      await ports.openExternal(CONTAINERS_DOCUMENTATION);
      await showQuickPick();
    }
  }

  async function presentNoServerSource(failed: Failed): Promise<'handled'> {
    const open = translate(SERVER_SOURCE_BUTTONS.openSetting);
    const chosen = await ports.showError(
      '',
      reasonText(failed.reason, translate),
      [open, translate(SERVER_SOURCE_BUTTONS.cancel)],
    );
    if (chosen === open) {
      await ports.openSetting(DOWNLOAD_SETTING);
    }
    return 'handled';
  }

  return {
    present: async failed => {
      if (failed.kind === 'noServerSource') {
        return presentNoServerSource(failed);
      }
      const folder = target();
      const dialog = failureDialogOf(failed, folder, translate);
      const chosen = await ports.showError(
        dialog.message,
        dialog.detail,
        dialog.buttons.map(button => button.label),
      );
      // Escape is the last button, the close affordance: More Actions....
      const button = dialog.buttons.find(each => each.label === chosen);
      if (button?.action === 'retry') {
        return 'reload';
      }
      if (button?.action === 'editLocally') {
        await editLocally(button.folder);
      } else if (button?.action === 'learnMore') {
        await ports.openExternal(CONTAINERS_REQUIREMENTS);
        ports.later(() => void showQuickPick());
      } else {
        ports.later(() => void showQuickPick());
      }
      return 'handled';
    },
  };
}
