/**
 * @fileoverview C8's presenter for a window that failed to attach: the modal error with its three buttons, and the
 * quick pick More Actions... opens. It waits for the user, so the resolve stays open while the dialog shows.
 */

import type {Failed, FailurePresenter} from 'lib-authority';
import type {Logger} from 'lib-log';
import {attachDialogOf, attachPickOf} from './attach-dialog.ts';
import type {Translate} from './engine-dialogs.ts';
import {chosenButton, type ErrorButton, pickedItem} from './choose.ts';
import {
  CONTAINERS_DOCUMENTATION,
  CONTAINERS_REQUIREMENTS,
} from './recovery-presenter.ts';

/** What the presenter shows and does. */
export interface AttachRecoveryPorts {
  /** Shows the modal error; resolves with the chosen button's label, or undefined. */
  showError(
    message: string,
    detail: string,
    buttons: readonly ErrorButton[],
  ): PromiseLike<string | undefined>;
  /** Shows the quick pick; resolves with the chosen label, or undefined. */
  pick(
    placeholder: string,
    labels: readonly string[],
  ): PromiseLike<string | undefined>;
  /** Starts or unpauses the container that was not running; whether it did. */
  startContainer(): PromiseLike<boolean>;
  /** Reopens the picker of running containers in this window. */
  chooseContainer(): PromiseLike<unknown>;
  closeRemote(): PromiseLike<unknown>;
  reloadWindow(): PromiseLike<unknown>;
  openRecent(): PromiseLike<unknown>;
  openExternal(address: string): PromiseLike<unknown>;
  /** Runs `task` once the current call stack has unwound. */
  later(task: () => void): void;
  /** Tells that the dialog ended in More Actions..., so the window stays disconnected. */
  disconnected(): void;
  logger: Logger;
}

/** The presenter over `ports`. */
export function attachRecoveryPresenterOf(
  ports: AttachRecoveryPorts,
  translate: Translate,
): FailurePresenter {
  /** Starts the container; a failed start is only logged, and the reload that follows finds it still not running. */
  async function started(): Promise<void> {
    if (!(await ports.startContainer())) {
      ports.logger.warn('the container could not be started');
    }
  }

  /** The quick pick of More Actions...; Open Documentation shows it again. */
  async function showQuickPick(failed: Failed): Promise<void> {
    const pick = attachPickOf(failed, translate);
    const item = await pickedItem(ports, pick);
    if (item?.action === 'startContainer') {
      await started();
      await ports.reloadWindow();
    } else if (item?.action === 'chooseContainer') {
      await ports.chooseContainer();
    } else if (item?.action === 'reload') {
      await ports.reloadWindow();
    } else if (item?.action === 'openRecent') {
      await ports.openRecent();
    } else if (item?.action === 'learnMore') {
      await ports.openExternal(CONTAINERS_REQUIREMENTS);
      await showQuickPick(failed);
    } else if (item?.action === 'openDocumentation') {
      await ports.openExternal(CONTAINERS_DOCUMENTATION);
      await showQuickPick(failed);
    }
  }

  return {
    present: async failed => {
      const dialog = attachDialogOf(failed, translate);
      const button = await chosenButton(
        ports,
        dialog.message,
        dialog.detail,
        dialog.buttons,
      );
      if (button?.action === 'retry') {
        return 'reload';
      }
      if (button?.action === 'startContainer') {
        await started();
        return 'reload';
      }
      if (button?.action === 'closeRemote') {
        await ports.closeRemote();
      } else if (button?.action === 'chooseContainer') {
        await ports.chooseContainer();
      } else if (button?.action === 'learnMore') {
        await ports.openExternal(CONTAINERS_REQUIREMENTS);
        ports.disconnected();
        ports.later(() => void showQuickPick(failed));
      } else {
        // More Actions..., and Escape, which the editor gives back as the choice of the close affordance.
        ports.disconnected();
        ports.later(() => void showQuickPick(failed));
      }
      return 'handled';
    },
  };
}
