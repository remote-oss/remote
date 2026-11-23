/**
 * @fileoverview The relay's sign-in until it has one: every request is refused as unsigned, so the service is never an
 * open relay.
 */

import {problem} from './problem.ts';
import type {Authenticate} from './routes.ts';

/** Refuses every request as unsigned. */
export const refuseAll: Authenticate = () =>
  Promise.resolve(problem(401, 'Sign in with a GitHub account.'));
