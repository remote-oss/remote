/**
 * @fileoverview A recording channel that answers every script it runs with one exit status, for the rows of code
 * that writes a file into the container.
 */

import {RecordingChannel} from 'lib-host/testing/recording-channel';

/** A channel that answers every script with `status`. */
export function channelAnswering(status: number): RecordingChannel {
  return new RecordingChannel({
    identity: 'c1',
    platformHint: 'linux',
    scripts: [
      {
        interpreter: 'posixShell',
        matches: () => true,
        lines: [],
        ending: {kind: 'exit', status},
      },
    ],
  });
}
