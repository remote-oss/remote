/**
 * @fileoverview The relay's sign-in until it has one: every request is refused as unsigned, so the service is never an
 * open relay.
 */

import {problem, type Answer} from './problem.ts';

/** Refuses every request as unsigned. */
export function refuseAll(): Promise<Answer> {
  return Promise.resolve(problem(401, 'Sign in with a GitHub account.'));
}
