/**
 * @fileoverview The error hint of a server download the client could not make: its status as the message, the failure's
 * own words as the details, and no steps to take.
 */

import type {FailureHint} from 'lib-ssh';
import {textOfId} from '../surfaces/failure-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** The hint for a client download that failed with `value` as its reason, its text in the display language. */
export function localDownloadHint(
  value: string,
  translate: Translate,
): FailureHint {
  return {
    status: 'LocalDownloadFailed',
    message: 'Error: LocalDownloadFailed',
    details: {text: textOfId('S071', translate, [value])},
    mitigations: [],
    resources: [],
  };
}
