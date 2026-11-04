/**
 * @fileoverview The dialog of an attach that did not end in a connection, and the quick pick its More Actions... button
 * opens: their texts, their order and the action of each choice. Pure. The buttons are in logical order, primary first;
 * the editor arranges them for its platform.
 */

import type {Failed} from 'lib-authority';
import type {Translate} from './engine-dialogs.ts';
import {failureText, reasonText} from './failure-strings.ts';

/** What choosing a button or an item does. */
type AttachAction =
  | 'chooseContainer'
  | 'learnMore'
  | 'startContainer'
  | 'retry'
  | 'closeRemote'
  | 'moreActions'
  | 'reload'
  | 'openRecent'
  | 'openDocumentation';

/** One button or item. */
interface AttachChoice {
  label: string;
  action: AttachAction;
}

/** A modal error dialog: its detail and its buttons. */
export interface AttachDialog {
  /** The message above the detail; empty for most failures. */
  message: string;
  detail: string;
  buttons: readonly AttachChoice[];
}

/** The quick pick of More Actions...: its placeholder and its items. */
export interface AttachPick {
  placeholder: string;
  items: readonly AttachChoice[];
}

/** The primary button of the failure: the choice that gets the attach going again. */
function primaryOf(kind: string, translate: Translate): AttachChoice {
  if (kind === 'requirementsNotMet') {
    return {label: failureText('S218', [], translate), action: 'learnMore'};
  }
  if (kind === 'attachedNotFound') {
    return {
      label: failureText('chooseContainer', [], translate),
      action: 'chooseContainer',
    };
  }
  return kind === 'attachedNotRunning'
    ? {
        label: failureText('startContainer', [], translate),
        action: 'startContainer',
      }
    : {label: failureText('S297', [], translate), action: 'retry'};
}

/** The dialog of an attach failure. */
export function attachDialogOf(
  failed: Failed,
  translate: Translate,
): AttachDialog {
  return {
    message:
      failed.kind === 'requirementsNotMet'
        ? failureText('S346', [], translate)
        : '',
    detail: reasonText(failed.reason, translate),
    buttons: [
      primaryOf(failed.kind, translate),
      {label: failureText('S076', [], translate), action: 'closeRemote'},
      {label: failureText('S227', [], translate), action: 'moreActions'},
    ],
  };
}

/**
 * The quick pick of More Actions...: for a failure that has a primary action it comes first, as its dialog's button
 * does; the set-up failure has no Retry here and starts with Reload Window.
 */
export function attachPickOf(failed: Failed, translate: Translate): AttachPick {
  const first: AttachChoice =
    failed.kind === 'attachFailed'
      ? {label: failureText('S289', [], translate), action: 'reload'}
      : primaryOf(failed.kind, translate);
  return {
    placeholder: failureText('S272', [], translate),
    items: [
      first,
      {label: failureText('S260', [], translate), action: 'openRecent'},
      {label: failureText('S256', [], translate), action: 'openDocumentation'},
    ],
  };
}
