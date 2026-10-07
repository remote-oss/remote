/**
 * @fileoverview The one adapter between lib-standdown and the editor: extension lookup, context keys, the warning
 * and the Extensions view.
 */

import type * as vscode from 'vscode';
import type {StandDownHost} from './stand-down.ts';

/** The part of the editor API the adapter uses; the extension passes the real `vscode` module. */
export type EditorApi = Pick<
  typeof vscode,
  'extensions' | 'commands' | 'window'
>;

/** The editor operations of the stand-down guard over `editor`. */
export function standDownHost(editor: EditorApi): StandDownHost {
  return {
    isRunning: extensionId =>
      editor.extensions.getExtension(extensionId) !== undefined,
    setContext: (contextKey, value) =>
      editor.commands.executeCommand('setContext', contextKey, value),
    showWarning: (text, button) =>
      editor.window.showWarningMessage(text, button),
    revealExtension: extensionId =>
      editor.commands.executeCommand(
        'workbench.extensions.search',
        `@id:${extensionId}`,
      ),
  };
}
