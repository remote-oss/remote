/**
 * @fileoverview The hidden "Open Web UI" command of a connected window: it hands `http://localhost:<port>/`, the
 * address of the window's server on the host's loopback, to the external browser. It keeps nothing, shows nothing
 * and ignores what it is invoked with.
 */

import {serverPort, type StartedServer} from 'lib-server';

/** The port of the server the window's most recent connect started, if one runs. */
export interface ServerPortRecord {
  /** Notes the server a connect started, or none when it started no server. */
  remember(started: StartedServer | undefined): void;
  /** The port, or `none` when no server runs. */
  current(): number | 'none';
}

/** An empty record. */
export function createServerPortRecord(): ServerPortRecord {
  const state: {started: StartedServer | undefined} = {started: undefined};
  return {
    remember: started => {
      state.started = started;
    },
    current: () => serverPort(state.started),
  };
}

/** What the command needs of the editor. */
export interface WebUiEditor {
  /** Hands an address to the external browser. */
  openExternal(address: string): PromiseLike<unknown>;
}

/** The handler of the command: never rejects, whatever it is given. */
export function createOpenWebUi(
  record: ServerPortRecord,
  editor: WebUiEditor,
): () => Promise<void> {
  return async () => {
    const port = record.current();
    if (port === 'none') {
      return;
    }
    try {
      await editor.openExternal(`http://localhost:${String(port)}/`);
    } catch {
      // The command shows nothing and logs nothing, so a refusal of the browser ends here.
    }
  };
}
