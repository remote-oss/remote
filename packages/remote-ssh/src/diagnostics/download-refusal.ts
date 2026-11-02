/**
 * @fileoverview The error hints of a download that the host could not make while the client may not: what failed, and
 * the steps to take, among them the one that lets the client download.
 */

import {
  FAILING_CONNECTIONS_TOPIC,
  type DiagnosticStringId,
  type FailureHint,
  type FilledString,
} from 'lib-ssh';
import {settings} from '../identifiers.generated.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** Why the host could not download. */
export type DownloadRefusal = 'downloadFailed' | 'noDownloader';

/** A string of the table, with its values. */
function mitigation(
  stringId: DiagnosticStringId,
  ...values: string[]
): FilledString {
  return {id: stringId, values};
}

/** The hint for `cause`, its texts in the display language. */
export function downloadRefusalHint(
  cause: DownloadRefusal,
  translate: Translate,
): FailureHint {
  function text(stringId: DiagnosticStringId): string {
    return ownText({id: stringId, values: []}, translate);
  }
  const download = settings.localServerDownload.id;
  if (cause === 'downloadFailed') {
    return {
      status: 'ServerDownloadFailed',
      message: `${text('S003')} (${text('S043')})`,
      mitigations: [
        mitigation('S054'),
        mitigation('S080'),
        mitigation('S049', download),
        mitigation('S081', settings.httpProxy.id, settings.httpsProxy.id),
        mitigation('S154'),
      ],
      resources: [FAILING_CONNECTIONS_TOPIC],
    };
  }
  return {
    status: 'NoDownloaderAvailable',
    message: `${text('S159')} (${text('S042')})`,
    mitigations: [
      mitigation('S083', 'wget'),
      mitigation('S083', 'curl'),
      mitigation('S052', 'PATH'),
      mitigation('S055'),
      mitigation('S050', download),
    ],
    resources: [],
  };
}
