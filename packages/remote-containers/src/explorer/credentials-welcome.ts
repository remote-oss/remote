/**
 * @fileoverview Which welcome the Dev Containers view shows when its listing failed on an SSH endpoint's questions: the
 * generic one, or the one that asks for SSH credentials. It follows what the questions of the listing came to and what
 * the view showed before.
 */

import type {QuestionMode, QuestionOutcome} from '../engine/ssh-questions.ts';
import type {WelcomeKey} from './targets-model.ts';

/** What the view showed before the listing: its rows, or one of the two welcomes of a failed listing. */
export type ShownBefore =
  'listing' | 'needsDockerStartOrInstall' | 'needsSSHCredentials';

/**
 * The welcome of a failed listing started in `mode`, whose questions came to `outcome`, after the view showed `before`:
 * 1. a box of the listing was answered or dismissed: the generic welcome;
 * 2. an automatic listing with a question refused for lack of an answer or by a remembered decline: the credentials welcome;
 * 3. a remembered answer was replayed and the listing still failed: the credentials welcome;
 * 4. a view listing with a remembered decline applied: what the view showed before stays, and the generic welcome after rows;
 * 5. otherwise the generic welcome.
 */
export function failureWelcomeOf(
  mode: QuestionMode,
  outcome: QuestionOutcome,
  before: ShownBefore,
): WelcomeKey {
  if (outcome.boxClosed) {
    return 'needsDockerStartOrInstall';
  }
  if (mode === 'automatic' && outcome.refused) {
    return 'needsSSHCredentials';
  }
  if (outcome.replayed) {
    return 'needsSSHCredentials';
  }
  if (mode === 'view' && outcome.declinedApplied) {
    return before === 'listing' ? 'needsDockerStartOrInstall' : before;
  }
  return 'needsDockerStartOrInstall';
}
