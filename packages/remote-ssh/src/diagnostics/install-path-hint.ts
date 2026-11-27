/**
 * @fileoverview The error hint of an install folder setting the client's check rejected: its message, the value as
 * written as its details, and the steps to take.
 */

import type {FailureHint} from 'lib-ssh';
import {settings} from '../identifiers.generated.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** The hint for the install folder `value` that is not a plain absolute path, its texts in the display language. */
export function installPathHint(
  value: string,
  translate: Translate,
): FailureHint {
  const setting = settings.serverInstallPath.id;
  return {
    status: 'InvalidCustomServerPath',
    message: ownText({id: 'S143', values: []}, translate),
    details: {text: `Provided: "${value}"`},
    mitigations: [
      {id: 'S058', values: []},
      {id: 'S048', values: [setting]},
      {id: 'S038', values: [setting]},
      {id: 'S033', values: []},
    ],
    resources: [],
  };
}
