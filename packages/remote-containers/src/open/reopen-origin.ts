/**
 * @fileoverview The four Reopen Folder commands over the window's origin: Reopen Locally reopens the host folder
 * the container was opened from, and the three in-remote commands refuse in a window whose origin is local.
 */

import {openLocal, type OpenerHost} from 'lib-authority';
import type {ReopenOrigin} from '../authority/payload.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {REOPEN_TEMPLATES} from '../surfaces/reopen-strings.ts';

/** What the Reopen Folder commands read and call. */
export interface ReopenOriginPorts {
  /** The window's origin (`windowOriginOf` of its authority), or none; read at each invocation. */
  origin(): ReopenOrigin | undefined;
  /** Whether the window has a folder or workspace open. */
  folderOpen(): boolean;
  opener: OpenerHost;
  /** Shows a plain information message, without waiting for it. */
  inform(text: string): void;
  translate: Translate;
}

/** The handlers of the four Reopen Folder commands. */
export function reopenOriginHandlersOf(ports: ReopenOriginPorts): {
  reopenLocally: () => Promise<void>;
  reopenInSSH: () => void;
  reopenInWSL: () => void;
  reopenInTunnel: () => void;
} {
  /** The refusal of an in-remote reopen: its text once, or nothing for a window with no origin. */
  function refuse(template: keyof typeof REOPEN_TEMPLATES): () => void {
    return () => {
      const origin = ports.origin();
      if (origin === undefined) {
        return;
      }
      ports.inform(ports.translate(REOPEN_TEMPLATES[template]));
    };
  }
  return {
    reopenLocally: async () => {
      const origin = ports.origin();
      if (origin === undefined || !ports.folderOpen()) {
        return;
      }
      await openLocal(ports.opener, {
        path: origin.folder,
        pathKind: 'folder',
        target: 'current',
      });
    },
    reopenInSSH: refuse('S010'),
    reopenInWSL: refuse('S012'),
    reopenInTunnel: refuse('S011'),
  };
}
