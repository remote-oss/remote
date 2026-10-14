/**
 * @fileoverview The question the user is asked before a server that comes under licence terms is installed: a modal
 * with the extension's own wording and the buttons Accept and Continue and Cancel. Only the first accepts.
 */

import type {LicenceModal} from 'lib-server';
import type {Translate} from './engine-dialogs.ts';
import {filled} from './filled.ts';

/** What the editor shows. */
export interface LicenceDialogPort {
  /** A modal warning with the detail and the buttons; the chosen button, or nothing for Escape or its close. */
  showModal(
    message: string,
    detail: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
}

/** The texts of the modal. */
const LICENCE_TEMPLATES = {
  cancel: 'Cancel',
  message:
    '{0} needs you to accept the license terms of the {1} server before installing it.',
  detail: 'Read the terms at {0}.',
  accept: 'Accept and Continue',
} as const;

/** The question as the modal shows it: the message, the detail and the two buttons, the first of which accepts. */
function questionOf(
  translate: Translate,
  names: {displayName: string; applicationName: string},
  termsUrl: string,
): {message: string; detail: string; accept: string; cancel: string} {
  return {
    message: filled(translate, LICENCE_TEMPLATES.message, [
      names.displayName,
      names.applicationName,
    ]),
    detail: filled(translate, LICENCE_TEMPLATES.detail, [termsUrl]),
    accept: filled(translate, LICENCE_TEMPLATES.accept),
    cancel: filled(translate, LICENCE_TEMPLATES.cancel),
  };
}

/** The modal over `dialog`, naming the extension and the application. */
export function licenceModalOf(
  dialog: LicenceDialogPort,
  translate: Translate,
  names: {displayName: string; applicationName: string},
): LicenceModal {
  return {
    askUser: async (termsUrl, cancellation) => {
      if (cancellation.aborted) {
        return 'cancel';
      }
      const question = questionOf(translate, names, termsUrl);
      const chosen = await Promise.resolve(
        dialog.showModal(question.message, question.detail, [
          question.accept,
          question.cancel,
        ]),
      ).catch(() => undefined);
      return chosen === question.accept ? 'accept' : 'cancel';
    },
  };
}
