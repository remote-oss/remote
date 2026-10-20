/**
 * @fileoverview The question the user is asked before a server that comes under licence terms is installed: a modal
 * information message with the extension's own wording and the address of the terms, and one button, Accept and
 * Continue. Only that button accepts; everything else, including the editor's Cancel and closing the modal, cancels.
 */

import type {LicenceModal, ModalAnswer} from 'lib-server';
import {filled, type Translate} from './strings.ts';

/** What the editor shows. */
export interface LicenceDialogPort {
  /** A modal information message with the detail and the extension's one item; resolves with the item, or nothing for the editor's Cancel, Escape or X. */
  showModal(
    message: string,
    detail: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
}

/** The names the modal's texts use. */
export interface LicenceNames {
  /** The extension's display name. */
  displayName: string;
}

/** The texts of the modal. */
const LICENCE_TEMPLATES = {
  serverLicenseMessage: "Accept the server's licence terms?",
  serverLicenseDetail:
    'The server {0} installs or starts on this host is distributed under licence terms of its own, which {0} does not accept for you. Read them at {1} before you continue. "Accept and Continue" accepts them for this profile; the choice is remembered for this profile.',
  acceptAndContinue: 'Accept and Continue',
} as const;

/** The modal over `dialog`, with the texts in the display language. */
export function licenceModalOf(
  dialog: LicenceDialogPort,
  translate: Translate,
  names: LicenceNames,
): LicenceModal {
  const accept = filled(translate, LICENCE_TEMPLATES.acceptAndContinue);
  return {
    askUser: async (termsUrl, cancellation): Promise<ModalAnswer> => {
      if (cancellation.aborted) {
        return 'cancel';
      }
      const answered = Promise.resolve(
        dialog.showModal(
          filled(translate, LICENCE_TEMPLATES.serverLicenseMessage),
          filled(translate, LICENCE_TEMPLATES.serverLicenseDetail, [
            names.displayName,
            termsUrl,
          ]),
          [accept],
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
