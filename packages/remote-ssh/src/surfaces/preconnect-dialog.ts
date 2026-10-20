/**
 * @fileoverview The question the user is asked before a pre-connection script runs: a modal warning message with the
 * script's path, and three buttons, Allow, Allow and Don't Ask Again, and Skip. Skip, the editor's Cancel, Escape and
 * closing the modal all skip the script.
 */

import {answeredOrAborted} from './abortable.ts';
import {filled, type Translate} from './strings.ts';

/** What the user chose: run the script once, run it and remember the choice, or leave it out. */
export type PreconnectAnswer = 'allow' | 'allowAlways' | 'skip';

/** The question over a script. */
export interface PreconnectDialog {
  /**
   * Asks about the script at `path`; `changed` picks the message that says its contents changed since the last
   * confirmation. 'skip' also for Cancel, Escape and X; 'aborted' when `cancellation` fires first.
   */
  askUser(
    path: string,
    changed: boolean,
    cancellation: AbortSignal,
  ): Promise<PreconnectAnswer | 'aborted'>;
}

/** What the editor shows. */
export interface PreconnectDialogPort {
  /** A modal warning message with the detail and the extension's items; the editor adds Cancel. */
  showModal(
    message: string,
    detail: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
}

/** The texts of the dialog. */
const PRECONNECT_TEMPLATES = {
  message: 'Execute pre-connection script?',
  changedMessage: 'Pre-connection script has changed since last confirmation',
  detail: "'{0}' will be executed on your local machine.",
  allow: 'Allow',
  allowAlways: "Allow and Don't Ask Again",
  skip: 'Skip',
} as const;

/** The dialog over `port`, with the texts in the display language. */
export function preconnectDialogOf(
  port: PreconnectDialogPort,
  translate: Translate,
): PreconnectDialog {
  const allow = filled(translate, PRECONNECT_TEMPLATES.allow);
  const allowAlways = filled(translate, PRECONNECT_TEMPLATES.allowAlways);
  const skip = filled(translate, PRECONNECT_TEMPLATES.skip);
  return {
    askUser: async (path, changed, cancellation) => {
      if (cancellation.aborted) {
        return 'aborted';
      }
      const answered = Promise.resolve(
        port.showModal(
          filled(
            translate,
            changed
              ? PRECONNECT_TEMPLATES.changedMessage
              : PRECONNECT_TEMPLATES.message,
          ),
          filled(translate, PRECONNECT_TEMPLATES.detail, [path]),
          [allow, allowAlways, skip],
        ),
      ).then(
        (chosen): PreconnectAnswer => {
          if (chosen === allow) {
            return 'allow';
          }
          return chosen === allowAlways ? 'allowAlways' : 'skip';
        },
        // A dialog that cannot be shown leaves the script out.
        (): PreconnectAnswer => 'skip',
      );
      return answeredOrAborted<PreconnectAnswer | 'aborted'>(
        answered,
        cancellation,
        'aborted',
      );
    },
  };
}
