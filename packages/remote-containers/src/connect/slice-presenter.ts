/**
 * @fileoverview How slice 1 tells the user that a connect failed: one modal error dialog with a Retry button, and for a
 * window without a download address for the server, a button to the setting that names one.
 */

import type {Failed, FailureReason, FailurePresenter} from 'lib-authority';
import {ownText} from '../surfaces/own-strings.ts';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The English template of each string of the editor's table that a failure's reason or message names. */
const FAILURE_TEMPLATES = {
  S034: 'An error occurred setting up the container.',
  S031: "Alpine Linux is not supported on the hardware architecture '{0}' of the container.",
  S104: "Current user does not have permission to run 'docker'. Try adding the user to the 'docker' group.",
  S144: 'Docker returned an error. Make sure the Docker daemon is running and select an option how to proceed.',
  S339: "The 'docker' command was not found. Make sure Docker is installed.",
  S346: 'The container does not meet all the requirements of the VS Code Server.',
  S359: "The hardware architecture '{0}' of the container is not supported.",
} as const;

/** The labels of the dialog's buttons. */
const PRESENTER_BUTTONS = {
  retry: 'Retry',
  openSetting: 'Open Setting',
  cancel: 'Cancel',
} as const;

/** The setting whose address a missing server source asks the user to set. */
const DOWNLOAD_SETTING = 'remote.serverDownloadBaseUrl';

/** What the presenter shows and opens. */
export interface PresenterPorts {
  /** Shows a modal error with its detail and buttons; undefined when the user dismissed it. */
  showError(
    message: string,
    detail: string,
    items: readonly string[],
  ): Promise<string | undefined>;
  /** Opens the settings editor on `setting`. */
  openSetting(setting: string): PromiseLike<unknown>;
}

/** The text of a reason, resolved through the string table. */
function reasonText(
  reason: FailureReason | undefined,
  translate: Translate,
): string {
  if (reason === undefined) {
    return '';
  }
  if ('text' in reason) {
    return reason.text;
  }
  const values = 'values' in reason ? reason.values.map(String) : [];
  if (Object.hasOwn(FAILURE_TEMPLATES, reason.id)) {
    return filled(
      translate,
      FAILURE_TEMPLATES[reason.id as keyof typeof FAILURE_TEMPLATES],
      values,
    );
  }
  return ownText(reason.id, values, translate);
}

/** The presenter of slice 1. */
export function slicePresenterOf(
  ports: PresenterPorts,
  translate: Translate,
): FailurePresenter {
  return {
    present: async (failed: Failed) => {
      const detail = reasonText(failed.reason, translate);
      if (failed.kind === 'noServerSource') {
        const open = translate(PRESENTER_BUTTONS.openSetting);
        const chosen = await ports.showError('', detail, [
          open,
          translate(PRESENTER_BUTTONS.cancel),
        ]);
        if (chosen === open) {
          await ports.openSetting(DOWNLOAD_SETTING);
        }
        return 'handled';
      }
      const retry = translate(PRESENTER_BUTTONS.retry);
      const message =
        failed.kind === 'requirementsNotMet'
          ? translate(FAILURE_TEMPLATES.S346)
          : '';
      const chosen = await ports.showError(message, detail, [retry]);
      return chosen === retry ? 'reload' : 'handled';
    },
  };
}
