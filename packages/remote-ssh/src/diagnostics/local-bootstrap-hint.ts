/**
 * @fileoverview The error hint of a manual bootstrap that could not start on the client: that the local bootstrap
 * failed, with what went wrong, and the six steps to take, among them putting the server where the bootstrap reads it.
 */

import type {FailureHint} from 'lib-ssh';
import {settings} from '../identifiers.generated.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** The value the first step names for `remote.SSH.localServerDownload`. */
const AUTOMATIC_DOWNLOAD = 'auto';

/** The program the copy to the host runs, which the fifth step names. */
const COPY_PROGRAM = 'scp';

/** The hint for a bootstrap that stopped with `detail`, the reason's own text, in the display language. */
export function localBootstrapHint(
  detail: string,
  translate: Translate,
): FailureHint {
  return {
    status: 'LocalBootstrapFailed',
    message: ownText({id: 'S087', values: []}, translate),
    details: {text: detail},
    mitigations: [
      {
        id: 'S016',
        values: [settings.localServerDownload.id, AUTOMATIC_DOWNLOAD],
      },
      {id: 'S036', values: [settings.useExecServer.id]},
      {id: 'S040', values: []},
      {id: 'S106', values: []},
      {id: 'S051', values: [COPY_PROGRAM]},
      {id: 'S124', values: []},
    ],
    resources: [],
  };
}
