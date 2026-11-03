/**
 * @fileoverview The error hint of a proxy setting the URI parser rejected: the value, the parser's message, and the
 * steps to take.
 */

import type {FailureHint} from 'lib-ssh';
import type {ProxyProblem} from '../pipeline/proxy-check.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** The parser's message without its one closing full stop, as the hint quotes it. */
function withoutFinalStop(message: string): string {
  return message.endsWith('.') ? message.slice(0, -1) : message;
}

/** The hint for `problem`; the parenthesised account of the value is English, as the parser's message is. */
export function invalidProxyHint(
  problem: ProxyProblem,
  translate: Translate,
): FailureHint {
  const lead = ownText({id: 'S109', values: []}, translate);
  return {
    status: 'InvalidProxyUrl',
    message: `${lead} (Provided URL '${problem.value}' resulted in Error: ${withoutFinalStop(problem.error)})`,
    mitigations: [
      {id: 'S113', values: []},
      {id: 'S151', values: ['http://', 'https://']},
      {id: 'S152', values: []},
    ],
    resources: [],
  };
}
