/**
 * @fileoverview What the rows of the server's steps on a host share: the product the connect installs the server of,
 * and the scripted answer of a script on the host's channel.
 */

import type {ScriptAnswer} from 'lib-host/testing/recording-channel';
import type {ProductProfile} from 'lib-product';

/** A product whose server has no licence and no download address. */
export const PROFILE: ProductProfile = {
  applicationName: 'fixture',
  commit: 'abc123',
  version: '1.2.3',
  release: '',
  quality: 'stable',
  serverApplicationName: 'fixture-server',
  serverDataFolderName: '.fixture-server',
  serverDownloadRedirectHosts: [],
  serverDownloadUrlTemplate: '',
  serverLicense: [],
  serverLicenseUrl: '',
  dataFolderName: '.fixture',
  tunnelApplicationName: 'fixture-tunnel',
  urlProtocol: 'fixture',
  cliDownloadUrlTemplate: '',
  updateUrl: '',
  downloadUrl: '',
};

/** The answer of the script that `matches` picks out: it prints `lines` and exits with `status`. */
export function answer(
  matches: (script: string) => boolean,
  lines: readonly string[],
  status = 0,
): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches,
    lines,
    ending: {kind: 'exit', status},
  };
}
