/**
 * @fileoverview The texts of the connection progress: the title it starts with, which is a link to the log, and the
 * message of each stage, which core shows after the title and a colon.
 */

import type {ConnectPhase} from 'lib-authority';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The English templates of the progress. */
const PROGRESS_TEMPLATES = {
  S087: '[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)',
  S209: 'Installing server',
  S334: 'Starting server',
} as const;

/** The stage text, by the stage that names it. */
const STAGE_TEMPLATES = {
  installing: PROGRESS_TEMPLATES.S209,
  startingServer: PROGRESS_TEMPLATES.S334,
} as const;

/** The title the progress starts with. */
export function startTitleOf(translate: Translate): string {
  return translate(PROGRESS_TEMPLATES.S087);
}

/**
 * The message of a stage, which core shows after the start title and a colon: the stage's text, or an empty message
 * for a stage that has none.
 */
export function phaseTitleOf(
  phase: Pick<ConnectPhase, 'name'>,
  translate: Translate,
): string {
  return phase.name === 'installing' || phase.name === 'startingServer'
    ? translate(STAGE_TEMPLATES[phase.name])
    : '';
}
