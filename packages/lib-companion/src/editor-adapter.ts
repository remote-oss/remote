/**
 * @fileoverview The one adapter between the call protocol and the editor: the command bus over the editor's commands
 * and the timers over the host's clock. The extension passes the editor's API in.
 */

import type * as vscode from 'vscode';
import type {ExtensionLookup} from './detector.ts';
import type {CommandBus, Timers} from './protocol.ts';

/** The part of the editor API the adapter uses; the extension passes the real `vscode` module. */
export type CompanionEditorApi = Pick<typeof vscode, 'commands'>;

/** The part of the editor API the detector's lookup uses. */
export type DetectorEditorApi = Pick<typeof vscode, 'extensions'>;

/**
 * The editor's lookup of extensions. Asking with the second argument true looks across extension hosts when the editor
 * grants the proposal and in the extension's own host otherwise; the list across hosts is never read, which throws
 * without the grant.
 */
export function extensionLookup(editor: DetectorEditorApi): ExtensionLookup {
  return {
    hasExtension: extensionId =>
      editor.extensions.getExtension(extensionId, true) !== undefined,
    onDidChange: listener =>
      editor.extensions.onDidChange(() => {
        listener();
      }),
  };
}

/** The command bus over the editor's commands. */
export function commandBus(editor: CompanionEditorApi): CommandBus {
  return {
    executeCommand: (commandId, argument) =>
      editor.commands.executeCommand(commandId, argument),
    registerCommand: (commandId, callback) =>
      editor.commands.registerCommand(commandId, callback),
  };
}

/** The timers over the host's clock. */
export const systemTimers: Timers = {
  setTimer: (callback, milliseconds) =>
    globalThis.setTimeout(callback, milliseconds),
  clearTimer: handle => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
