/**
 * @fileoverview The window's side of the forwarding in the editor: the hidden terminal that makes the agent link, and
 * the variables the window's terminals get. It touches `vscode` only for its types: the editor is a value it is given.
 */

import type * as vscode from 'vscode';
import type {LinkTerminals} from '../pipeline/forwarding-step.ts';

/**
 * Link terminals in the editor: each run creates one hidden, transient terminal that runs the program, with no folder,
 * so that a remote window starts it on the host, and gives its exit status once the editor has closed it; the
 * terminal is then disposed.
 */
export function linkTerminalsOf(
  editor: Pick<typeof vscode, 'window'>,
): LinkTerminals {
  return {
    runProgram: (name, program, programArguments) =>
      new Promise(resolve => {
        const target: {terminal: vscode.Terminal | undefined} = {
          terminal: undefined,
        };
        const closeSubscription = editor.window.onDidCloseTerminal(closed => {
          if (closed !== target.terminal) {
            return;
          }
          closeSubscription.dispose();
          closed.dispose();
          resolve(closed.exitStatus?.code);
        });
        target.terminal = editor.window.createTerminal({
          name,
          shellPath: program,
          shellArgs: [...programArguments],
          hideFromUser: true,
          isTransient: true,
        });
      }),
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
