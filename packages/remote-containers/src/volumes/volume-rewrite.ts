/**
 * @fileoverview The override rewrite of a clone in a volume, for a CLI bridge: the volume form of the pre-pass, with
 * the one log line that says a configuration's own workspace is ignored.
 */

import type {Logger} from 'lib-log';
import {
  type VolumeWorkspace,
  volumeOverrideText,
} from '../cli/override-pre-pass.ts';

/** The rewrite a bridge of a clone in a volume gives every configuration text it reads. */
export function volumeRewriteOf(
  environment: Readonly<Record<string, string | undefined>>,
  workspace: VolumeWorkspace,
  logger: Logger,
): (configText: string) => string | undefined {
  return configText => {
    const rewritten = volumeOverrideText(configText, environment, workspace);
    if (rewritten?.ownWorkspace === true) {
      logger.info(
        "the configuration's own workspaceMount and workspaceFolder are ignored: a clone in a volume has the volume's",
      );
    }
    return rewritten?.text;
  };
}
