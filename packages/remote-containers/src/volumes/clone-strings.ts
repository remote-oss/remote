/**
 * @fileoverview The texts of Clone Repository in Container Volume, by their string ids, and the text one of them gives
 * with its values.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';

/** The English template of each text, by the id of the editor's string table, or by a name of ours. */
const CLONE_TEMPLATES = {
  S052: "Cannot access the repository '{0}'.",
  S067: 'Choose a repository to clone in a Container Volume',
  S068: 'Choose which repository to clone',
  S071: 'Clone a repository from {0} in a Container Volume',
  S072: 'Clone git repository from URL',
  S075: 'Cloning a repository in a Dev Container may execute arbitrary code.',
  S252: 'Only clone a repository in a Dev Container if you trust its authors.',
  S414: 'You must select a container configuration since the repository does not contain a dev container configuration. Without a dev container configuration the container cannot be started.',
  gotIt: 'Got It',
  learnMore: 'Learn More',
  sourcePlaceholder: 'Provide repository URL or pick a repository source.',
  hostKeyContinue: 'Continue',
  selectConfiguration: 'Select Configuration',
  cancel: 'Cancel',
  github: 'GitHub',
  remoteSources: 'remote sources',
} as const;

/** The name of a text of the clone's command. */
export type CloneTextName = keyof typeof CLONE_TEMPLATES;

/** The text named `name` in the display language, filled with `values`. */
export function cloneText(
  name: CloneTextName,
  translate: Translate,
  values: readonly string[] = [],
): string {
  return filled(translate, CLONE_TEMPLATES[name], values);
}
