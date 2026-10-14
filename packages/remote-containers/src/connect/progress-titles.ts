/**
 * @fileoverview The titles of the connection progress: the one it starts with, which is a link to the log, and the
 * stage that follows it after a colon.
 */

import type {ConnectPhase} from 'lib-authority';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The English templates of the progress. */
const PROGRESS_TEMPLATES = {
  S087: '[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)',
  S209: 'Installing server',
  S334: 'Starting server',
} as const;

/** What follows the start title, by the stage that names it. */
const STAGE_TEMPLATES = {
  installing: PROGRESS_TEMPLATES.S209,
  startingServer: PROGRESS_TEMPLATES.S334,
} as const;

/** The title the progress starts with. */
export function startTitleOf(translate: Translate): string {
  return translate(PROGRESS_TEMPLATES.S087);
}

/** The title for a stage: the start title, with the stage's text after a colon when it has one. */
export function phaseTitleOf(
  phase: Pick<ConnectPhase, 'name'>,
  translate: Translate,
): string {
  const start = startTitleOf(translate);
  return phase.name === 'installing' || phase.name === 'startingServer'
    ? `${start}: ${translate(STAGE_TEMPLATES[phase.name])}`
    : start;
}
