/**
 * @fileoverview The last stage of the wizard: which of the template's optional files and directories to include. The
 * screen lists them as the template names them, none checked and none focused; what is not checked is left out of the
 * copy. Escape, or anything else that hides the screen, includes every one.
 */

import {pickBooleans, type QuickInputPorts} from './option-screens.ts';

/** The English template of each text of the stage, by its string id. */
const OPTIONAL_PATHS_TEMPLATES = {
  S203: 'Include the following optional files/directories',
  S266: 'Optional Files/Directories',
} as const;

/** How the stage ends. */
export type OptionalPathsAnswer =
  /** `omitPaths` is every entry that was not checked. */
  {kind: 'chosen'; omitPaths: readonly string[]} | {kind: 'back'};

/** Asks which of `paths` to include. */
export async function askOptionalPaths(
  paths: readonly string[],
  quick: QuickInputPorts,
  cancellation: AbortSignal,
): Promise<OptionalPathsAnswer> {
  const answer = await pickBooleans(
    {
      title: quick.translate(OPTIONAL_PATHS_TEMPLATES.S266),
      placeholder: quick.translate(OPTIONAL_PATHS_TEMPLATES.S203),
      keepOpen: true,
      unfocused: true,
      items: paths.map(path => ({key: path, label: path, checked: false})),
    },
    quick,
    cancellation,
  );
  if (answer.kind === 'back') {
    return {kind: 'back'};
  }
  if (answer.kind === 'escape') {
    return {kind: 'chosen', omitPaths: []};
  }
  return {
    kind: 'chosen',
    omitPaths: paths.filter(path => !answer.checked.has(path)),
  };
}
