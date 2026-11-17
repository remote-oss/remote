/**
 * @fileoverview The error hint of an install folder the host could not create: what failed, and the steps to take, the
 * first of them to remove or edit the setting that names the folder.
 */

import type {FailureHint} from 'lib-ssh';
import {settings} from '../identifiers.generated.ts';

/** The text the explanation shows for the default folder, which the host's shell expands and the client does not. */
const DEFAULT_FOLDER = '$HOME';

/** The hint for a host that could not create its install folder, its texts left to the recorder, which writes them in the display language. */
export function installFolderHint(): FailureHint {
  const setting = settings.serverInstallPath.id;
  return {
    status: 'CreateInstallDirFailed',
    message: {id: 'S139', values: [DEFAULT_FOLDER, setting]},
    details: {id: 'S070'},
    mitigations: [
      {id: 'S112', values: [setting]},
      {id: 'S053', values: []},
      {id: 'S056', values: []},
      {id: 'S061', values: []},
    ],
    resources: [],
  };
}
