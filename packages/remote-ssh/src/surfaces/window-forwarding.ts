/**
 * @fileoverview The window's side of the forwarding in the editor: the extension terminal that makes the agent link
 * when the editor opens it, and the variables the window's terminals get. It touches `vscode` only for its types: the
 * editor is a value it is given.
 */

import type * as vscode from 'vscode';
import type {LinkTerminals} from '../pipeline/forwarding-step.ts';

/**
 * Link terminals in the editor: each open creates an extension terminal whose pseudoterminal runs the work when the
 * editor opens it, after the editor's own checks, and then closes. The editor gives an extension terminal no way to
 * stay out of the terminal list, so it shows there while the work runs.
 */
export function linkTerminalsOf(
  editor: Pick<typeof vscode, 'window' | 'EventEmitter'>,
): LinkTerminals {
  return {
    open: (name, work) => {
      const written = new editor.EventEmitter<string>();
      const closed = new editor.EventEmitter<undefined>();
      function end(): void {
        closed.fire(undefined);
        closed.dispose();
        written.dispose();
      }
      editor.window.createTerminal({
        name,
        ['pty']: {
          onDidWrite: written.event,
          onDidClose: closed.event,
          open: () => {
            void work().then(end, end);
          },
          close: () => undefined,
        },
      });
    },
  };
}

/**
 * The window's terminal variables in the editor's collection: only these, replaced for each connect, and never kept
 * for a later session of the window.
 */
export function terminalEnvironmentOf(
  collection: Pick<
    vscode.EnvironmentVariableCollection,
    'persistent' | 'clear' | 'replace'
  >,
): (variables: Readonly<Record<string, string>>) => void {
  return variables => {
    collection.persistent = false;
    collection.clear();
    for (const [name, value] of Object.entries(variables)) {
      collection.replace(name, value);
    }
  };
}
