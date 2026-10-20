/**
 * @fileoverview The failure dialog of a connect that did not end in a connection, and the quick pick that
 * its More Actions... button opens: their texts, their order and the action of each choice. Pure.
 */

import type {Failed} from 'lib-authority';
import type {DevContainerFolder} from '../authority/payload.ts';
import type {Translate} from './engine-dialogs.ts';
import {failureText, reasonText} from './failure-strings.ts';

/** One button of the dialog and what choosing it does; Edit Locally names the folder it goes back to. */
type FailureButton =
  | {label: string; action: 'retry' | 'moreActions' | 'learnMore'}
  | {label: string; action: 'editLocally'; folder: DevContainerFolder};

/** A modal error dialog: its message, its detail and its buttons, in the order they are passed to the editor. */
export interface FailureDialog {
  message: string;
  detail: string;
  buttons: readonly FailureButton[];
}

/** One item of the quick pick and what choosing it does. */
type PickItem =
  | {
      label: string;
      action: 'reload' | 'rebuild' | 'openRecent' | 'openDocumentation';
    }
  | {label: string; action: 'editLocally'; folder: DevContainerFolder};

/** The quick pick of More Actions...: its placeholder and its items. */
export interface QuickPick {
  placeholder: string;
  items: readonly PickItem[];
}

/** The text of the Edit button or item for the folder of `target`. */
function editLabel(target: DevContainerFolder, translate: Translate): string {
  const configPath = target.configFile.path;
  return failureText(
    'S158',
    [configPath.slice(configPath.lastIndexOf('/') + 1)],
    translate,
  );
}

/** The dialog of a failure, for the folder the window was opening (none when its authority names no folder). */
export function failureDialogOf(
  failed: Failed,
  target: DevContainerFolder | undefined,
  translate: Translate,
): FailureDialog {
  const requirements = failed.kind === 'requirementsNotMet';
  const edit: FailureButton[] =
    target === undefined
      ? []
      : [
          {
            label: editLabel(target, translate),
            action: 'editLocally',
            folder: target,
          },
        ];
  const first: FailureButton = requirements
    ? {label: failureText('S218', [], translate), action: 'learnMore'}
    : {label: failureText('S297', [], translate), action: 'retry'};
  return {
    message: requirements ? failureText('S346', [], translate) : '',
    detail:
      failed.reason === undefined
        ? failureText('S034', [], translate)
        : reasonText(failed.reason, translate),
    buttons: [
      first,
      ...edit,
      {label: failureText('S227', [], translate), action: 'moreActions'},
    ],
  };
}

/** The quick pick that More Actions... opens; it offers a rebuild when the failed connect found a container. */
export function quickPickOf(
  target: DevContainerFolder | undefined,
  containerFound: boolean,
  translate: Translate,
): QuickPick {
  const edit: PickItem[] =
    target === undefined
      ? []
      : [
          {
            label: editLabel(target, translate),
            action: 'editLocally',
            folder: target,
          },
        ];
  const rebuild: PickItem[] = containerFound
    ? [
        {
          label: failureText('S285', [], translate),
          action: 'rebuild',
        },
      ]
    : [];
  return {
    placeholder: failureText('S272', [], translate),
    items: [
      {label: failureText('S289', [], translate), action: 'reload'},
      ...rebuild,
      ...edit,
      {label: failureText('S260', [], translate), action: 'openRecent'},
      {label: failureText('S256', [], translate), action: 'openDocumentation'},
    ],
  };
}
