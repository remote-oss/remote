/**
 * @fileoverview The Open Web UI command: it opens the address of the server of the window's current connection in the
 * browser, and does nothing when no server is known or the browser cannot be opened.
 */

import type {CommandHandler} from 'lib-identifiers';
import {webUiUrl} from '../window/web-ui.ts';

/** What the command needs: the current server's port, and the browser. */
export interface WebUiPorts {
  /** The TCP port of the server of the window's current connection; `none` while no server is known. */
  serverPort(): number | 'none';
  /** Opens the address outside the editor. */
  openExternal(address: string): PromiseLike<boolean>;
}

/** The handler of Open Web UI: it opens the server's address when one is known, and nothing else. */
export function openWebUiHandler(ports: WebUiPorts): CommandHandler {
  return {
    execute: async () => {
      const address = webUiUrl(ports.serverPort());
      if (address === undefined) {
        return;
      }
      try {
        await ports.openExternal(address);
      } catch {
        return;
      }
    },
  };
}
