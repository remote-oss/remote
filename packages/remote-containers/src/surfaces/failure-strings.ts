/**
 * @fileoverview The texts of the failure dialog and its quick pick, by the id of the editor's string table, and the
 * text of a failure's reason.
 */

import type {FailureReason, ReasonValue} from 'lib-authority';
import type {Translate} from './engine-dialogs.ts';
import {filled} from './filled.ts';
import {ownText} from './own-strings.ts';

/** The English template of each string of the editor's table that the dialog, the quick pick or a reason shows. */
export const FAILURE_TEMPLATES = {
  S018: 'A mount config is invalid. Make sure it has the right format and a source folder that exists on the machine where the Docker daemon is running.',
  S019: 'A port the container is setup to bind to is already in use. See the Dev Containers terminal for details.',
  S031: "Alpine Linux is not supported on the hardware architecture '{0}' of the container.",
  S034: 'An error occurred setting up the container.',
  S104: "Current user does not have permission to run 'docker'. Try adding the user to the 'docker' group.",
  S144: 'Docker returned an error. Make sure the Docker daemon is running and select an option how to proceed.',
  S158: 'Edit {0} Locally',
  S218: 'Learn More',
  S227: 'More Actions...',
  S256: 'Open Documentation',
  S260: 'Open Recent...',
  S272: 'Pick an action to help resolve the problem.',
  S285: 'Rebuild Container',
  S289: 'Reload Window',
  S297: 'Retry',
  S339: "The 'docker' command was not found. Make sure Docker is installed.",
  S346: 'The container does not meet all the requirements of the VS Code Server.',
  S359: "The hardware architecture '{0}' of the container is not supported.",
} as const;

/** The text of a value of a placeholder: a literal as it is, or a string of the table resolved in turn. */
function valueText(value: ReasonValue, translate: Translate): string {
  return typeof value === 'string'
    ? value
    : failureText(value.id, value.values, translate);
}

/** The text of the string `stringId` of the table (or of our own) with its placeholders filled by `values`. */
export function failureText(
  stringId: string,
  values: readonly ReasonValue[],
  translate: Translate,
): string {
  const texts = values.map(value => valueText(value, translate));
  return Object.hasOwn(FAILURE_TEMPLATES, stringId)
    ? filled(
        translate,
        FAILURE_TEMPLATES[stringId as keyof typeof FAILURE_TEMPLATES],
        texts,
      )
    : ownText(stringId, texts, translate);
}

/** The text of a failure's reason: the failing step's own text, or a string of the table; none when it has none. */
export function reasonText(
  reason: FailureReason | undefined,
  translate: Translate,
): string {
  if (reason === undefined) {
    return '';
  }
  return 'text' in reason
    ? reason.text
    : failureText(
        reason.id,
        'values' in reason ? reason.values : [],
        translate,
      );
}
