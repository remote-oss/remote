/**
 * @fileoverview The editor's side of the session troubleshooting terminal: an extension terminal over the
 * pseudoterminal the check builds, and the link provider that makes the "Output Log..." at its end open the log.
 * `vscode` is imported as a type only; the extension passes the editor.
 */

import type * as vscode from 'vscode';
import {
  outputLogLinks,
  TERMINAL_NAME,
  type TablePty,
  type TerminalSink,
  type TroubleshootingPorts,
} from './diagnostics/troubleshooting.ts';

/** The terminals the check made and the link provider's registration. */
export interface TroubleshootingEditor {
  createTerminal: TroubleshootingPorts['createTerminal'];
  /** Registers the provider of the link; the registration ends with the returned disposable. */
  registerLinks(): vscode.Disposable;
}

/** The terminal and the links over `editor`; `showLog` reveals the extension's log. */
export function troubleshootingEditorOf(
  editor: Pick<typeof vscode, 'window' | 'EventEmitter'>,
  showLog: () => void,
): TroubleshootingEditor {
  const made = new WeakSet<vscode.Terminal>();
  return {
    createTerminal: make => {
      const written = new editor.EventEmitter<string>();
      const sink: TerminalSink = {
        write: text => {
          written.fire(text);
        },
      };
      const driver: TablePty = make(sink);
      const adapter: vscode.Pseudoterminal = {
        onDidWrite: written.event,
        open: dimensions => {
          driver.open(dimensions?.columns);
        },
        close: () => {
          driver.close();
          written.dispose();
        },
        handleInput: data => {
          driver.handleInput(data);
        },
        setDimensions: dimensions => {
          driver.setDimensions(dimensions.columns);
        },
      };
      const terminal = editor.window.createTerminal({
        name: TERMINAL_NAME,
        // eslint-disable-next-line id-length -- the editor's option is named pty
        pty: adapter,
      });
      made.add(terminal);
      return {
        show: preserveFocus => {
          terminal.show(preserveFocus);
        },
        dispose: () => {
          terminal.dispose();
        },
      };
    },
    registerLinks: () =>
      editor.window.registerTerminalLinkProvider({
        provideTerminalLinks: context =>
          made.has(context.terminal)
            ? outputLogLinks(context.line).map(link => ({
                ...link,
                tooltip: 'Output Log...',
              }))
            : [],
        handleTerminalLink: () => {
          showLog();
        },
      }),
  };
}
