/**
 * @fileoverview The dialog Remote - SSH shows when a connect fails: the message with Close Remote, Retry and More
 * Actions, or, for a server download location that is missing or unusable, the message with Open Setting and Cancel.
 * The editor is behind two ports. The dialog is started and not waited for: its buttons act when the user presses
 * them, and the window is told at once that the user is being told.
 */

import type {Failed, FailurePresenter} from 'lib-authority';
import {
  reasonText,
  SERVER_SOURCE_TEMPLATES,
  textOfId,
  textOfTemplate,
} from './failure-strings.ts';
import type {Translate} from './strings.ts';

/** The setting that holds the template of the server download URL. */
const DOWNLOAD_TEMPLATE_SETTING = 'remote.SSH.serverDownloadUrlTemplate';

/** What the editor shows. */
export interface FailureDialogPort {
  /** Shows the modal error with the buttons in this order; resolves with the chosen button, or nothing for cancel. */
  showError(
    text: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
}

/** What the buttons do. */
export interface FailureActions {
  /** Retry. */
  reload(): PromiseLike<unknown>;
  closeRemote(): PromiseLike<unknown>;
  /** More Actions: the picker of the other actions. */
  moreActions(failed: Failed): PromiseLike<unknown>;
  openSetting(settingId: string): PromiseLike<unknown>;
}

/** The names the dialog texts use. */
export interface PresenterNames {
  /** The host alias of the window, as the user wrote it. */
  alias(): string;
  /** The client's application name. */
  applicationName: string;
  /** The extension's display name. */
  displayName: string;
}

/** The text with a full stop at its end, unless it has one. */
function endedWithStop(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/** What a dialog is, as the presenter builds it: its text and the buttons with what each does. */
interface Dialog {
  text: string;
  buttons: ReadonlyArray<readonly [string, () => PromiseLike<unknown>]>;
  /** What closing the dialog without a button does. */
  dismissed: () => PromiseLike<unknown>;
}

/** The presenter of Remote - SSH, over the dialog and the actions. */
export function failurePresenterOf(
  dialog: FailureDialogPort,
  actions: FailureActions,
  translate: Translate,
  names: PresenterNames,
): FailurePresenter {
  function nothing(): PromiseLike<unknown> {
    return Promise.resolve();
  }

  function serverSourceDialog(failed: Failed): Dialog {
    const reason =
      failed.reason === undefined
        ? undefined
        : reasonText(failed.reason, translate);
    const template =
      failed.kind === 'noServerSource'
        ? SERVER_SOURCE_TEMPLATES.noServerSource
        : SERVER_SOURCE_TEMPLATES.invalidServerTemplate;
    return {
      text: textOfTemplate(template, translate, [
        names.applicationName,
        DOWNLOAD_TEMPLATE_SETTING,
        names.displayName,
        reason ?? '',
      ]),
      buttons: [
        [
          textOfTemplate(SERVER_SOURCE_TEMPLATES.openSetting, translate, []),
          () => actions.openSetting(DOWNLOAD_TEMPLATE_SETTING),
        ],
        [textOfId('S015', translate), nothing],
      ],
      dismissed: nothing,
    };
  }

  function connectionDialog(failed: Failed): Dialog {
    const alias = names.alias();
    const reason =
      failed.reason === undefined
        ? undefined
        : reasonText(failed.reason, translate);
    return {
      text: endedWithStop(
        reason === undefined
          ? textOfId('S030', translate, [alias])
          : textOfId('S031', translate, [alias, reason]),
      ),
      buttons: [
        [textOfId('S022', translate), () => actions.closeRemote()],
        [textOfId('S117', translate), () => actions.reload()],
        [textOfId('S092', translate), () => actions.moreActions(failed)],
      ],
      dismissed: () => actions.moreActions(failed),
    };
  }

  return {
    present: failed => {
      const shown =
        failed.kind === 'noServerSource' ||
        failed.kind === 'invalidServerTemplate'
          ? serverSourceDialog(failed)
          : connectionDialog(failed);
      // The buttons act later, and nothing they do or fail to do changes what the window was told.
      void Promise.resolve(
        dialog.showError(
          shown.text,
          shown.buttons.map(([label]) => label),
        ),
      )
        .then(chosen => {
          const button = shown.buttons.find(([label]) => label === chosen);
          return button === undefined ? shown.dismissed() : button[1]();
        })
        .catch(() => undefined);
      return Promise.resolve('handled');
    },
  };
}
