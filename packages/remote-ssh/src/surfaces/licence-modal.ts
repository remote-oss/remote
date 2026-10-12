/**
 * @fileoverview The question the user is asked before a server that comes under licence terms is installed: a modal
 * with the extension's own wording, the address of the terms, and the buttons Accept and Continue and Cancel. Only
 * the first button accepts; everything else, including closing the modal, cancels.
 */

import type {LicenceModal, ModalAnswer} from 'lib-server';
import {filled, type Translate} from './strings.ts';

/** What the editor shows. */
export interface LicenceDialogPort {
  /** A modal warning with the detail and the buttons; resolves with the chosen button, or nothing for Escape or X. */
  showModal(
    message: string,
    detail: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
}

/** The names the modal's message uses. */
export interface LicenceNames {
  /** The client's application name. */
  applicationName: string;
  /** The extension's display name. */
  displayName: string;
}

/** The texts of the modal; those with no string id yet are provisional. */
const LICENCE_TEMPLATES = {
  cancel: 'Cancel',
  message:
    '{0} needs you to accept the license terms of the {1} server before installing it.',
  detail: 'Read the terms at {0}.',
  accept: 'Accept and Continue',
} as const;

/** The modal over `dialog`, with the texts in the display language. */
export function licenceModalOf(
  dialog: LicenceDialogPort,
  translate: Translate,
  names: LicenceNames,
): LicenceModal {
  const accept = filled(translate, LICENCE_TEMPLATES.accept);
  return {
    askUser: async (termsUrl, cancellation): Promise<ModalAnswer> => {
      if (cancellation.aborted) {
        return 'cancel';
      }
      const answered = Promise.resolve(
        dialog.showModal(
          filled(translate, LICENCE_TEMPLATES.message, [
            names.displayName,
            names.applicationName,
          ]),
          filled(translate, LICENCE_TEMPLATES.detail, [termsUrl]),
          [accept, filled(translate, LICENCE_TEMPLATES.cancel)],
        ),
      ).then(
        (chosen): ModalAnswer => (chosen === accept ? 'accept' : 'cancel'),
        // A modal that cannot be shown is no acceptance.
        (): ModalAnswer => 'cancel',
      );
      const waiting: {stop?: () => void} = {};
      const aborted = new Promise<ModalAnswer>(resolve => {
        function onAbort(): void {
          resolve('cancel');
        }
        cancellation.addEventListener('abort', onAbort, {once: true});
        waiting.stop = () => {
          cancellation.removeEventListener('abort', onAbort);
        };
      });
      try {
        return await Promise.race([answered, aborted]);
      } finally {
        waiting.stop?.();
      }
    },
  };
}
