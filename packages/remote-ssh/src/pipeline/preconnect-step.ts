/**
 * @fileoverview The pre-connection script step, until the script runner exists: a connect that no script applies to
 * goes on, and one that a script applies to fails, with the cause in the log, rather than connect without the script
 * the user asked for.
 */

import type {Logger} from 'lib-log';
import {hostAlias, preconnectScriptFor} from './host-settings.ts';
import type {ConnectSteps} from './steps.ts';

/** What the step reads. */
export interface PreconnectStepDependencies {
  /** The value of `remote.SSH.preconnect`, as the user wrote it; read for each connect. */
  setting: () => unknown;
  logger: Logger;
}

/** The step over `remote.SSH.preconnect`. */
export function preconnectStep(
  dependencies: PreconnectStepDependencies,
): ConnectSteps['preconnect'] {
  return input => {
    const script = preconnectScriptFor(
      dependencies.setting(),
      hostAlias(input.target),
    );
    if (script === undefined) {
      return Promise.resolve({kind: 'done', value: undefined});
    }
    dependencies.logger.warn(
      'a pre-connection script is set for this host, and running one is not built yet',
    );
    return Promise.resolve({
      kind: 'failed',
      failure: {kind: 'preconnectFailed'},
    });
  };
}
