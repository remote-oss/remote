/**
 * @fileoverview Login terminals in the editor: each open creates one terminal that runs the invocation, reads its output
 * through the terminal data event as plain text, and tells how it ended. The one module of the login terminal that
 * touches `vscode`, and only for its types: the editor is a value it is given.
 */

import type * as vscode from 'vscode';
import {type LoginTerminals, type TerminalEnd, TerminalStream} from 'lib-ssh';

/** The reason names the port tells, by the editor's exit reason. */
function reasonOf(
  editor: Pick<typeof vscode, 'TerminalExitReason'>,
  reason: vscode.TerminalExitReason,
): TerminalEnd['reason'] {
  const reasons = new Map<vscode.TerminalExitReason, TerminalEnd['reason']>([
    [editor.TerminalExitReason.Process, 'process'],
    [editor.TerminalExitReason.User, 'user'],
    [editor.TerminalExitReason.Extension, 'extension'],
    [editor.TerminalExitReason.Shutdown, 'shutdown'],
  ]);
  return reasons.get(reason) ?? 'unknown';
}

/** Login terminals in the editor: one terminal per open, its output read through the terminal data event. */
export function loginTerminalsOf(
  editor: Pick<typeof vscode, 'window' | 'TerminalExitReason' | 'Uri'>,
  homeFolder: string,
): LoginTerminals {
  return {
    open: (invocation, name, reveal) => {
      const stream = new TerminalStream();
      const target: {terminal: vscode.Terminal | undefined} = {
        terminal: undefined,
      };
      const dataSubscription = editor.window.onDidWriteTerminalData(event => {
        if (event.terminal === target.terminal) {
          stream.write(event.data);
        }
      });
      const closeSubscription = editor.window.onDidCloseTerminal(closed => {
        if (closed !== target.terminal) {
          return;
        }
        const status = closed.exitStatus;
        stream.end(
          status?.code,
          status === undefined ? 'unknown' : reasonOf(editor, status.reason),
        );
        dataSubscription.dispose();
        closeSubscription.dispose();
      });
      const created = editor.window.createTerminal({
        name,
        shellPath: invocation.program,
        shellArgs: invocation.arguments,
        // A folder URI of the file scheme makes the terminal a local one, also in a window that is still connecting.
        cwd: editor.Uri.file(homeFolder),
        env: invocation.environment,
        hideFromUser: !reveal,
      });
      target.terminal = created;
      if (reveal) {
        created.show(false);
      }
      let disposed = false;
      return {
        onOutput: listener => {
          stream.onOutput(listener);
        },
        onEnd: listener => {
          stream.onEnd(listener);
        },
        send: text => {
          created.sendText(text, false);
        },
        reveal: () => {
          created.show(false);
        },
        dispose: () => {
          if (!disposed) {
            disposed = true;
            created.dispose();
          }
        },
      };
    },
  };
}
