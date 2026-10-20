/**
 * @fileoverview The push of the window's outcome to Remote Explorer: once per extension-host session, an SSH window
 * when its first resolve settles and any other window at once, and none for a window with no folder or workspace.
 * A push that cannot be delivered is dropped.
 */

import type {LastResolve} from 'lib-authority';
import {
  type ActiveFoldersPush,
  hostKeyOfAuthority,
  writeActiveFoldersPush,
} from 'lib-companion';

/** What the push reads of the window, and when. */
export interface PushPorts {
  /** Whether the window has a folder or a workspace now. */
  hasWorkspace(): boolean;
  /** The window's authority, or undefined for a local window. */
  remoteAuthority(): string | undefined;
  /** The session's first resolve. */
  resolve: {
    onFirstResolveSettled(listener: () => void): void;
    lastResolve(): LastResolve;
  };
  /** Sends one push and forgets it. */
  send(push: ActiveFoldersPush): void;
}

/** Sends the push; one that cannot be sent is dropped, with no notice and no log line. */
function sendQuietly(ports: PushPorts, push: ActiveFoldersPush): void {
  try {
    ports.send(push);
  } catch {
    // The explorer's view does not depend on this push.
  }
}

/** Pushes the window's outcome once per extension-host session. */
export function pushActiveFolders(ports: PushPorts): void {
  if (!ports.hasWorkspace()) {
    return;
  }
  const authority = ports.remoteAuthority();
  const hostKey =
    authority === undefined ? undefined : hostKeyOfAuthority(authority);
  if (hostKey === undefined) {
    sendQuietly(ports, writeActiveFoldersPush({outcome: 'none'}));
    return;
  }
  let pushed = false;
  ports.resolve.onFirstResolveSettled(() => {
    if (pushed) {
      return;
    }
    pushed = true;
    sendQuietly(
      ports,
      writeActiveFoldersPush({
        outcome:
          ports.resolve.lastResolve() === 'succeeded' ? 'connected' : 'failed',
        hostKey,
      }),
    );
  });
}
