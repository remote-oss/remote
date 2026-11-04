/**
 * @fileoverview What kind of question git or ssh asks through the askpass program during a clone's checks, which
 * decides how the window shows it: a user name in plain text, a password or passphrase masked, a host key as a pick.
 */

import {isHostKeyQuestion} from '../askpass-text.ts';

/** How a question of a clone's check is shown. */
export type ClonePromptSurface = 'plainInput' | 'maskedInput' | 'hostKeyPick';

/** The start of git's user-name question for an HTTPS remote. */
const USER_NAME = 'Username for ';

/** The surface of a question's text: any question that isn't one of the two plain ones is masked. */
export function classifyClonePrompt(text: string): ClonePromptSurface {
  if (text.startsWith(USER_NAME)) {
    return 'plainInput';
  }
  return isHostKeyQuestion(text) ? 'hostKeyPick' : 'maskedInput';
}
