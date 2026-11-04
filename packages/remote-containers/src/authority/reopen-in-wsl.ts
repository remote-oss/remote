/**
 * @fileoverview Whether a dev container window can be reopened in WSL: its payload names a distro, or its folder lives
 * on a WSL share.
 */

import {decodeAuthority} from 'lib-authority';
import {shareToDistro} from 'lib-wsl';
import {devContainerTargetOf} from './payload.ts';

/** Whether the window of `authority` offers Reopen Folder in WSL. */
export function canReopenInWSLOf(authority: string | undefined): boolean {
  if (authority === undefined) {
    return false;
  }
  const decoded = decodeAuthority(authority);
  if (
    'malformed' in decoded ||
    decoded.family !== 'dev-container' ||
    !('payload' in decoded.target)
  ) {
    return false;
  }
  const target = devContainerTargetOf(decoded.target.payload);
  return (
    !('malformed' in target) &&
    target.kind === 'folder' &&
    (target.wslDistro !== undefined ||
      shareToDistro(target.hostPath).kind === 'share')
  );
}
